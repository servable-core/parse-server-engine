import mcache from 'memory-cache'

export default ({ duration, extent }) => {
  return (req, res, next) => {
    const resetCache = req.headers['x-servable-reset-cache']
    if (resetCache) {
      next()
      return
    }

    let key = '__express__' + req.originalUrl || req.url
    if (extent === 'user') {
      const sessionToken = req.headers['x-servable-session-token']
      if (!sessionToken) {
        next()
        return
      }
      key += sessionToken
    }

    let cachedBody = mcache.get(key)
    if (cachedBody) {
      res.send(cachedBody)
      return
    } else {
      res.sendResponse = res.send
      res.send = (body) => {
        mcache.put(key, body, duration)
        res.sendResponse(body)
      }
      next()
    }
  }
}
