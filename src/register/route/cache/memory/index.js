import mcache from 'memory-cache'

const CACHE_ENTRY_KEY = '__servable_cache_entry__'

export default ({ duration, extent }) => {
  return (req, res, next) => {
    const resetCache = req.headers['x-servable-reset-cache']
    if (resetCache) {
      next()
      return
    }

    let key = '__express__' + (req.originalUrl || req.url)
    if (extent === 'user') {
      const sessionToken = req.headers['x-servable-session-token']
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
