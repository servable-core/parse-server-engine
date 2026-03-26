import { createClient } from 'redis'
import getSessionTokenFromRequest from '../lib/getSessionTokenFromRequest.js'

const CACHE_ENTRY_KEY = '__servable_cache_entry__'
let redisClient
let redisClientPromise

const STRIPPED_QUERY_KEYS = new Set([
  'traceid',
  'trace_id',
  'tracespan',
  'trace_span',
  'traceparent',
  'tracestate',
  'spanid',
  'span_id',
  'parentspanid',
  'parent_span_id',
  'requestid',
  'request_id',
  'correlationid',
  'correlation_id'
])

const normalizeRedisUrl = (url) => {
  const raw = String(url || '').trim()
  if (!raw) {
    return null
  }

  return raw.includes('://') ? raw : `redis://${raw}`
}

const normalizeRequestUrl = (rawUrl) => {
  const safeRawUrl = String(rawUrl || '')

  try {
    const parsed = new URL(safeRawUrl, 'http://localhost')
    const keys = Array.from(new Set(Array.from(parsed.searchParams.keys())))

    keys.forEach((key) => {
      if (STRIPPED_QUERY_KEYS.has(String(key).toLowerCase())) {
        parsed.searchParams.delete(key)
      }
    })

    parsed.searchParams.sort()
    const normalizedQuery = parsed.searchParams.toString()

    return normalizedQuery
      ? `${parsed.pathname}?${normalizedQuery}`
      : parsed.pathname
  } catch {
    return safeRawUrl
  }
}

const getRedisClient = async ({ redisUrl }) => {
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

export default ({ duration, template, redisUrl = process.env.APP_REDIS_URI }) => {
  return async (req, res, next) => {
    const resetCache = req.headers['x-servable-reset-cache']
    if (resetCache) {
      next()
      return
    }

    const client = await getRedisClient({ redisUrl })
    if (!client) {
      next()
      return
    }

    const normalizedUrl = normalizeRequestUrl(req.originalUrl || req.url)
    let key = '__express__' + normalizedUrl
    if (String(template || '').trim().toLowerCase() === 'userexists') {
      const sessionToken = getSessionTokenFromRequest(req)
      if (!sessionToken) {
        next()
        return
      }
      key += `_${sessionToken}`
    }

    try {
      const cachedValue = await client.get(key)
      if (cachedValue !== null) {
        try {
          //console.log('[@servable/parse-server-engine/cache/redis] Cache hit for key:', key)
          const cachedEntry = JSON.parse(cachedValue)
          if (cachedEntry && cachedEntry[CACHE_ENTRY_KEY]) {
            //console.log('[@servable/parse-server-engine/cache/redis] Cache entry valid for key:', key)
            res.send(cachedEntry.body)
            return
          }
          //console.log('[@servable/parse-server-engine/cache/redis] Cache entry invalid for key:', key)
          res.send(cachedEntry)
          return
        } catch (error) {
          console.error('[@servable/parse-server-engine/cache/redis] Failed to parse cache entry for key:', key, error)
          res.send(cachedValue)
          return
        }
      }
    } catch (error) {
      console.error('[@servable/parse-server-engine/cache/redis] Failed to read cache', error)
    }

    res.sendResponse = res.send
    res.send = (body) => {
      const ttl = Number(duration)
      const ttlMs = Number.isFinite(ttl) && ttl >= 0 ? ttl : undefined

      if (!(ttlMs > 0)) {
        res.sendResponse(body)
        return
      }

      let payload
      try {
        payload = JSON.stringify({
          [CACHE_ENTRY_KEY]: true,
          body
        })
        //console.log('[@servable/parse-server-engine/cache/redis] Caching response for key:', key, 'with TTL (ms):', ttlMs)
      } catch (error) {
        console.error('[@servable/parse-server-engine/cache/redis] Failed to serialize cache payload', error)
        res.sendResponse(body)
        return
      }

      //console.log('[@servable/parse-server-engine/cache/redis] Setting cache with expiration for key:', key)
      client.set(key, payload, {
        PX: ttlMs
      }).catch((error) => {
        console.error('[@servable/parse-server-engine/cache/redis] Failed to write cache', error)
      })

      res.sendResponse(body)
    }

    next()
  }
}
