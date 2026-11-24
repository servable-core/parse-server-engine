// The session token a request carries, read in the order @servable/server's user resolver reads it
// (lib/servable/server src/launch/wireSchema/register/routes/utils/userResolver.js, getSessionToken): the
// `x-servable-session-token` header, then the cookies Express parsed, then the raw Cookie header. A cookie sent twice
// counts once, the first time, as `cookie.parse` (which the resolver and cookie-parser use) counts it: the cache files
// the answer under the session the resolver authenticates with.

/**
 * @param {unknown} rawCookieHeader
 * @returns {Record<string, string>}
 */
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
      if (!key || Object.prototype.hasOwnProperty.call(acc, key)) {
        return acc
      }

      acc[key] = value
      return acc
    }, /** @type {Record<string, string>} */ ({}))
}

/**
 * @param {any} [request] - Express's request.
 * @returns {string | null}
 */
export const getSessionTokenFromRequest = (request = {}) => {
  const headerToken = request?.headers?.['x-servable-session-token']
  if (headerToken) {
    return headerToken
  }

  const parsedCookieToken = request?.cookies?.['x-servable-session-token']
  if (parsedCookieToken) {
    return parsedCookieToken
  }

  const cookies = parseCookieHeader(request?.headers?.cookie)
  return cookies['x-servable-session-token'] || null
}

export default getSessionTokenFromRequest
