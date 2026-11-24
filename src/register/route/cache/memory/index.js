import mcache from 'memory-cache'
import routeCacheKeyOf, { isPerReaderTemplate } from '../lib/routeCacheKey.js'
import { readerCredentialKindOf } from '../lib/readerCredentials.js'
import isRouteCacheBypassedFor from '../lib/bypass.js'
import { keepTheAnswerOf, replayAnswer } from '../lib/cachedAnswer.js'
import { countTheRouteCacheLookup, countTheRouteCacheReaderCredential, countTheRouteCacheStore, isTheBypassHeaderRefusedFor, routeCacheBypassOutcomeOf } from '../lib/routeCacheCounts.js'

// The route cache in this process's memory. Same rules as the Redis store (../redis/index.js): only successes are
// kept, with their status and Content-Type, and replayed as they were sent; the key never holds a session or access token;
// only the server may skip it. The answer is kept as it is (no serialization at all). A window that is not a
// positive number keeps nothing (`memory-cache` threw on 0 and kept forever when it had none).

/**
 * @param {object} props
 * @param {number} props.duration - the window, in milliseconds.
 * @param {string | null} [props.template]
 * @param {string | null} [props.bypassSecret]
 * @param {{ get: (key: string) => any, put: (key: string, value: any, ttl: number) => any }} [props.store]
 * @param {string | null} [props.routePath] - the route's registered path, the label of its counts (lib/routeCacheCounts.js).
 */
export default ({ duration, template, bypassSecret = null, store = mcache, routePath = null }) => {
  const windowInMilliseconds = Number(duration)
  const isWindowPositive = Number.isFinite(windowInMilliseconds) && windowInMilliseconds > 0
  const count = (outcome) => countTheRouteCacheLookup({ routePath, storage: 'inMemory', outcome })
  const countTheStore = (outcome) => countTheRouteCacheStore({ routePath, storage: 'inMemory', outcome })

  return (req, res, next) => {
    if (isRouteCacheBypassedFor({ request: req, bypassSecret })) {
      count(routeCacheBypassOutcomeOf({ request: req, bypassSecret }) || 'bypass_in_process')
      next()
      return
    }
    if (isTheBypassHeaderRefusedFor(req)) {
      count('bypass_refused')
    }

    const key = routeCacheKeyOf({ request: req, template })
    if (isPerReaderTemplate(template)) {
      countTheRouteCacheReaderCredential({ storage: 'inMemory', credential: readerCredentialKindOf(req) })
    }
    if (!key) {
      count('no_key')
      next()
      return
    }

    const answer = store.get(key)
    // An entry an older engine kept (the whole body, whatever its status) has no status: never replayed.
    if (answer && Number(answer.status) >= 200 && Number(answer.status) < 300 && 'body' in answer) {
      count('hit')
      replayAnswer({ response: res, answer })
      return
    }
    count('miss')

    if (isWindowPositive) {
      keepTheAnswerOf({
        response: res,
        keepAnswer: ({ status, contentType, body }) => {
          try {
            store.put(key, { status, contentType, body }, windowInMilliseconds)
            countTheStore('stored')
          } catch (error) {
            countTheStore('write_failed')
            throw error
          }
        },
        onAnswerNotKept: () => countTheStore('not_cacheable'),
      })
    }

    next()
  }
}
