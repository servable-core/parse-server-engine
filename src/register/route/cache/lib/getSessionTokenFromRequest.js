const parseCookieHeader = (rawCookieHeader) => {
  const raw = String(rawCookieHeader || '').trim()
  if (!raw) {
    return {}
  }

  return raw
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, item) => {
      const index = item.indexOf('=')
      if (index <= 0) {
        return acc
      }

      const key = item.slice(0, index).trim()
      const value = item.slice(index + 1).trim()
      if (!key) {
        return acc
      }

      acc[key] = value
      return acc
    }, {})
}

export default (request = {}) => {
  const headerToken = request.headers?.['x-servable-session-token']
  if (headerToken) {
    return headerToken
  }

  const parsedCookieToken = request.cookies?.['x-servable-session-token']
  if (parsedCookieToken) {
    return parsedCookieToken
  }

  const cookies = parseCookieHeader(request.headers?.cookie)
  return cookies['x-servable-session-token'] || null
}
