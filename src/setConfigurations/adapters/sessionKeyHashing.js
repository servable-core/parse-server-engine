import { hashedSessionTokenOf } from '../../register/route/cache/lib/hashSessionToken.js'

// Parse Server's own cache keeps, for each session token it authenticated, the user under the key
// `<applicationId>:user:<session token>` (Auth.getAuthForSessionToken, rest.del, RestWrite.transformUser). With the
// Redis cache adapter (SERVABLE_REDIS_CACHE_URI) those raw bearer tokens became Redis key names (framework
// performance audit 2026-11-23, F9; owner's Q1095 a). Every key of that kind is rewritten here with the digest the
// route cache uses (register/route/cache/lib/hashSessionToken.js), on every read, write and delete, so Parse finds,
// replaces and drops its entries exactly as before. Other keys (roles by user id, the schema, GraphQL) are left as
// they are. Keys written before this change hold the raw token; they are never read again and expire with Parse's
// cache TTL.

const SESSION_USER_KEY_MARK = ':user:'

/**
 * @param {unknown} key
 * @returns {unknown}
 */
export const cacheKeyWithoutSessionToken = (key) => {
  if (typeof key !== 'string') {
    return key
  }
  const markAt = key.indexOf(SESSION_USER_KEY_MARK)
  if (markAt === -1) {
    return key
  }
  const tokenAt = markAt + SESSION_USER_KEY_MARK.length
  if (tokenAt >= key.length) {
    return key
  }
  return `${key.slice(0, tokenAt)}${hashedSessionTokenOf(key.slice(tokenAt))}`
}

/**
 * A subclass of a Parse cache adapter class whose keys never hold a session token. Everything else (connection,
 * TTL, shutdown, clear) is the adapter's own.
 * @template {new (...args: any[]) => any} AdapterClass
 * @param {AdapterClass} CacheAdapterClass
 * @returns {AdapterClass}
 */
export const withSessionTokensHashedInKeys = (CacheAdapterClass) => {
  if (typeof CacheAdapterClass !== 'function') {
    return CacheAdapterClass
  }
  // @ts-ignore - a mixin of a class only known at run time.
  return class extends CacheAdapterClass {
    get (key) {
      return super.get(cacheKeyWithoutSessionToken(key))
    }

    put (key, value, ttl) {
      return super.put(cacheKeyWithoutSessionToken(key), value, ttl)
    }

    del (key) {
      return super.del(cacheKeyWithoutSessionToken(key))
    }
  }
}
