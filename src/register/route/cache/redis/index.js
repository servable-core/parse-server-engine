import { createClient } from 'redis'
import routeCacheKeyOf from '../lib/routeCacheKey.js'
import isRouteCacheBypassedFor from '../lib/bypass.js'
import { answerOfRedisEntry, keepTheAnswerOf, redisEntryOf, replayAnswer } from '../lib/cachedAnswer.js'

// The route cache in Redis (APP_REDIS_URI), shared by every pod. What is kept and how it is replayed:
// ../lib/cachedAnswer.js; the key: ../lib/routeCacheKey.js; who may skip it: ../lib/bypass.js.
// `duration` is the route's window in milliseconds; an entry lives that long from when it was written, and a window
// that is not a positive number keeps nothing. Redis down or slow to connect: the route answers as if uncached.

let redisClient
let redisClientPromise

const normalizeRedisUrl = (url) => {
  const raw = String(url || '').trim()
  if (!raw) {
    return null
  }

  return raw.includes('://') ? raw : `redis://${raw}`
}

export const getRedisClient = async ({ redisUrl }) => {
  if (redisClient) {
    return redisClient
  }
  if (redisClientPromise) {
    return redisClientPromise
  }

  const normalizedRedisUrl = normalizeRedisUrl(redisUrl)
  if (!normalizedRedisUrl) {
    return null
  }

  const client = createClient({
    url: normalizedRedisUrl
  })

  client.on('error', (error) => {
    console.error('[@servable/parse-server-engine/cache/redis] Redis client error', error)
  })

  redisClientPromise = client.connect()
    .then(() => {
      redisClient = client
      return redisClient
    })
    .catch((error) => {
      console.error('[@servable/parse-server-engine/cache/redis] Failed to connect Redis client', error)
      redisClientPromise = null
      return null
    })

  return redisClientPromise
}

/**
 * @param {object} props
 * @param {number} props.duration - the window, in milliseconds.
 * @param {string | null} [props.template]
 * @param {string} [props.redisUrl]
 * @param {string | null} [props.bypassSecret]
 * @param {() => Promise<any>} [props.getClient] - for tests: the Redis client, else the shared one of `redisUrl`.
 */
export default ({ duration, template, redisUrl = process.env.APP_REDIS_URI, bypassSecret = null, getClient = () => getRedisClient({ redisUrl }) }) => {
  const windowInMilliseconds = Number(duration)
  const isWindowPositive = Number.isFinite(windowInMilliseconds) && windowInMilliseconds > 0

  return async (req, res, next) => {
    if (isRouteCacheBypassedFor({ request: req, bypassSecret })) {
      next()
      return
    }

    const key = routeCacheKeyOf({ request: req, template })
    if (!key) {
      next()
      return
    }

    const client = await getClient()
    if (!client) {
      next()
      return
    }

    try {
      const answer = answerOfRedisEntry(await client.get(key))
      if (answer) {
        replayAnswer({ response: res, answer })
        return
      }
    } catch (error) {
      console.error('[@servable/parse-server-engine/cache/redis] Failed to read cache', error)
    }

    if (isWindowPositive) {
      keepTheAnswerOf({
        response: res,
        keepAnswer: (answer) => {
          client.set(key, redisEntryOf(answer), { PX: windowInMilliseconds }).catch((error) => {
            console.error('[@servable/parse-server-engine/cache/redis] Failed to write cache', error)
          })
        },
      })
    }

    next()
  }
}
