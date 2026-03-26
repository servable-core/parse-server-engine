import mcache from 'memory-cache'
import getSessionTokenFromRequest from '../lib/getSessionTokenFromRequest.js'

const CACHE_ENTRY_KEY = '__servable_cache_entry__'

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

export default ({ duration, template }) => {
  return (req, res, next) => {
    const resetCache = req.headers['x-servable-reset-cache']
    if (resetCache) {
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
      key += sessionToken
    }

    let cachedEntry = mcache.get(key)
    if (cachedEntry && cachedEntry[CACHE_ENTRY_KEY]) {
      res.send(cachedEntry.body)
      return
    }
    if (cachedEntry !== null && cachedEntry !== undefined) {
      // Backward compatibility for entries stored before envelope format.
      res.send(cachedEntry)
      return
    } else {
      res.sendResponse = res.send
      res.send = (body) => {
        const ttl = Number(duration)
        const ttlMs = Number.isFinite(ttl) && ttl >= 0 ? ttl : undefined
        mcache.put(key, {
          [CACHE_ENTRY_KEY]: true,
          body
        }, ttlMs)
        res.sendResponse(body)
      }
      next()
    }
  }
}
