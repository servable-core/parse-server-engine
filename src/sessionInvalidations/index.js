// Tells whoever listens that what a session token resolves to may have changed: `Servable.App.SessionInvalidations`
// (framework performance audit 2026-11-23, F3; owner's Q1092 a). @servable/server's session-user cache
// (src/lib/sessionUserCache) forgets its entries on these reports, so a sign-out, a revoked session or a saved user
// is seen at once by the next request in this process.
//
// Where the reports come from, all inside Parse Server, so nothing depends on a Parse trigger (Parse keeps ONE
// trigger per class and operation and Servable's protocols own them; `_Session` accepts no trigger but afterLogout):
//   - `cacheController.user.del(token)`: Parse drops its own cached user for a token when that session is deleted
//     (rest.del of `_Session`: a sign-out, a revocation, any destroy of a session) and, for every session of a user,
//     when that user is updated (RestWrite.transformUser). Reported as `{ sessionToken }`, before the write.
//   - `DatabaseController.prototype.update` and `.destroy`, after the write: a `_User` updated or deleted is reported
//     as `{ userId }` (this closes the gap between Parse's early report and the write itself); a `_Session` updated
//     (its expiry, its device) as `{ sessionId }`; sessions destroyed by a query on their user (Parse revoking the
//     other sessions on a password change) as `{ userId }`. A write whose target cannot be read from its query is
//     reported as `{ isEverything: true }`.
// Not seen: a write that bypasses Parse (a raw MongoDB driver writing `_User` or `_Session`), and writes made by
// another process (another replica). Those are bounded by the cache's own time to live (10 seconds by default).

const LOG_PREFIX = '[ENGINE] [session invalidations]'

/** @typedef {{ sessionToken?: string, sessionId?: string, userId?: string, isEverything?: boolean }} SessionInvalidation */

/** @type {Set<(invalidation: SessionInvalidation) => void>} */
const listeners = new Set()

/** @type {{ isReported: boolean, reason?: string } | null} */
let installation = null

/**
 * Hands one report to every listener. A listener that throws never stops the others, nor the write that caused it.
 * @param {SessionInvalidation} invalidation
 */
export const reportSessionInvalidation = (invalidation) => {
  for (const listener of listeners) {
    try {
      listener(invalidation)
    } catch (error) {
      console.error(LOG_PREFIX, 'a listener failed', { message: error?.message })
    }
  }
}

/**
 * @param {any} query - a DatabaseController query (REST format).
 * @returns {string | null}
 */
const objectIdOf = (query) => (typeof query?.objectId === 'string' ? query.objectId : null)

/**
 * @param {any} query
 * @returns {string | null}
 */
const userIdOfSessionsQuery = (query) => {
  const user = query?.user
  return typeof user?.objectId === 'string' ? user.objectId : null
}

/**
 * What a write of `className` with `query` invalidates, or null when it touches no session's resolution.
 * @param {'update' | 'destroy'} operation
 * @param {string} className
 * @param {any} query
 * @returns {SessionInvalidation | null}
 */
export const invalidationOfWrite = (operation, className, query) => {
  if (className === '_User') {
    const userId = objectIdOf(query)
    return userId ? { userId } : { isEverything: true }
  }
  if (className !== '_Session') {
    return null
  }
  const userId = userIdOfSessionsQuery(query)
  if (userId) {
    return { userId }
  }
  const sessionId = objectIdOf(query)
  if (sessionId) {
    return { sessionId }
  }
  // Parse renews a session's expiry by its token (Auth.renewSessionIfNeeded).
  if (typeof query?.sessionToken === 'string') {
    return { sessionToken: query.sessionToken }
  }
  return { isEverything: true }
}

/**
 * Wraps `update` and `destroy` of Parse's DatabaseController prototype (Config.get makes a new controller per call,
 * so an instance wrapper would never be reached). The write's own answer and error are untouched.
 * @param {any} DatabaseController
 * @returns {() => void} restores Parse's own methods.
 */
export const reportWritesOf = (DatabaseController) => {
  const prototype = DatabaseController.prototype
  const originals = { update: prototype.update, destroy: prototype.destroy }
  for (const operation of /** @type {const} */ (['update', 'destroy'])) {
    const writeOfParse = originals[operation]
    if (writeOfParse.isReportingSessionInvalidations) {
      continue
    }
    /** @type {any} */
    const writeAndReport = function (className, query, ...rest) {
      const invalidation = invalidationOfWrite(operation, className, query)
      const result = writeOfParse.call(this, className, query, ...rest)
      if (!invalidation) {
        return result
      }
      return Promise.resolve(result).then((answer) => {
        reportSessionInvalidation(invalidation)
        return answer
      })
    }
    writeAndReport.isReportingSessionInvalidations = true
    prototype[operation] = writeAndReport
  }
  return () => {
    prototype.update = originals.update
    prototype.destroy = originals.destroy
  }
}

/**
 * Wraps `del` of Parse's user cache (one instance per application: every Config.get copies the same
 * cacheController).
 * @param {any} userCache - `cacheController.user`.
 */
export const reportDeletedUserCacheEntriesOf = (userCache) => {
  const delOfParse = userCache.del
  if (delOfParse.isReportingSessionInvalidations) {
    return
  }
  /** @type {any} */
  const delAndReport = function (sessionToken) {
    if (typeof sessionToken === 'string' && sessionToken.length > 0) {
      reportSessionInvalidation({ sessionToken })
    }
    return delOfParse.call(this, sessionToken)
  }
  delAndReport.isReportingSessionInvalidations = true
  userCache.del = delAndReport
}

// Parse Server's files are CommonJS compiled by Babel: the class is the module itself or its `default`.
/**
 * @param {any} loadedModule
 * @param {(candidate: any) => boolean} isWhatWeWant
 */
const classOf = (loadedModule, isWhatWeWant) => [loadedModule?.default, loadedModule?.default?.default, loadedModule].find((candidate) => candidate && isWhatWeWant(candidate))

/**
 * Installs the reports once Parse Server has started. Never throws: what cannot be installed is not reported, and
 * the answer says so (a listener then must not rely on reports).
 * @param {object} props
 * @param {() => string | undefined} props.applicationIdOf
 * @param {() => Promise<any>} [props.loadConfig]
 * @param {() => Promise<any>} [props.loadDatabaseController]
 * @returns {Promise<{ isReported: boolean, reason?: string }>}
 */
export const installTheSessionInvalidationReports = async ({
  applicationIdOf,
  // @ts-ignore - parse-server ships no declarations for its compiled lib/ files.
  loadConfig = async () => classOf(await import('parse-server/lib/Config.js'), (candidate) => typeof candidate?.get === 'function'),
  // @ts-ignore
  loadDatabaseController = async () => classOf(await import('parse-server/lib/Controllers/DatabaseController.js'), (candidate) => typeof candidate?.prototype?.update === 'function'),
}) => {
  if (installation?.isReported) {
    return installation
  }
  try {
    const Config = await loadConfig()
    const userCache = Config?.get(applicationIdOf())?.cacheController?.user
    if (typeof userCache?.del !== 'function') {
      return { isReported: false, reason: 'Parse Server has not started, or has no user cache' }
    }
    const DatabaseController = await loadDatabaseController()
    if (typeof DatabaseController?.prototype?.update !== 'function' || typeof DatabaseController?.prototype?.destroy !== 'function') {
      return { isReported: false, reason: 'the database controller has no update or destroy' }
    }
    reportDeletedUserCacheEntriesOf(userCache)
    reportWritesOf(DatabaseController)
    installation = { isReported: true }
    return installation
  } catch (error) {
    console.error(LOG_PREFIX, 'not installed', { message: error?.message })
    return { isReported: false, reason: error?.message }
  }
}

/**
 * `Servable.App.SessionInvalidations`: subscribe a listener. The answer says whether invalidations are reported in
 * this process; when they are not, the listener will never be called and a cache must not rely on it.
 * @param {object} props
 * @param {() => string | undefined} props.applicationIdOf
 */
export const createSessionInvalidations = ({ applicationIdOf }) => ({
  /**
   * @param {(invalidation: SessionInvalidation) => void} listener
   * @returns {Promise<{ isReported: boolean, reason?: string, unsubscribe: () => void }>}
   */
  subscribe: async (listener) => {
    const answer = await installTheSessionInvalidationReports({ applicationIdOf })
    if (!answer.isReported) {
      return { ...answer, unsubscribe: () => {} }
    }
    listeners.add(listener)
    return { isReported: true, unsubscribe: () => { listeners.delete(listener) } }
  },
})

/** For tests: forgets the listeners and the installation record (Parse's methods stay wrapped). */
export const resetSessionInvalidationsForTests = () => {
  listeners.clear()
  installation = null
}
