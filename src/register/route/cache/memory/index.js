import mcache from 'memory-cache'
import routeCacheKeyOf from '../lib/routeCacheKey.js'
import isRouteCacheBypassedFor from '../lib/bypass.js'
import { keepTheAnswerOf, replayAnswer } from '../lib/cachedAnswer.js'

// The route cache in this process's memory. Same rules as the Redis store (../redis/index.js): only successes are
// kept, with their status and Content-Type, and replayed as they were sent; the key never holds a session token;
// only the server may skip it. The answer is kept as it is (no serialization at all). A window that is not a
// positive number keeps nothing (`memory-cache` threw on 0 and kept forever when it had none).

/**
 * @param {object} props
 * @param {number} props.duration - the window, in milliseconds.
 * @param {string | null} [props.template]
 * @param {string | null} [props.bypassSecret]
 * @param {{ get: (key: string) => any, put: (key: string, value: any, ttl: number) => any }} [props.store]
 */
export default ({ duration, template, bypassSecret = null, store = mcache }) => {
  const windowInMilliseconds = Number(duration)
  const isWindowPositive = Number.isFinite(windowInMilliseconds) && windowInMilliseconds > 0

  return (req, res, next) => {
    if (isRouteCacheBypassedFor({ request: req, bypassSecret })) {
      next()
      return
    }

    const key = routeCacheKeyOf({ request: req, template })
    if (!key) {
      next()
      return
    }

    const answer = store.get(key)
    // An entry an older engine kept (the whole body, whatever its status) has no status: never replayed.
    if (answer && Number(answer.status) >= 200 && Number(answer.status) < 300 && 'body' in answer) {
      replayAnswer({ response: res, answer })
      return
    }

    if (isWindowPositive) {
      keepTheAnswerOf({
        response: res,
        keepAnswer: ({ status, contentType, body }) => {
          store.put(key, { status, contentType, body }, windowInMilliseconds)
        },
      })
    }

    next()
  }
}
