// The access token a request carries as `Authorization: Bearer <token>`, read exactly as @servable/server's user
// resolver reads it (lib/servable/server src/launch/wireSchema/register/routes/utils/userResolver.js: the header
// matched against /^Bearer\s+(.+)$/i), so the route cache and the resolver see the same credential. Null when the
// request has no such header (another scheme, `Bearer` with nothing after it, no header). The token is not verified
// here: the cache cannot, and does not need to (see ./readerCredentials.js).

const BEARER_PATTERN = /^Bearer\s+(.+)$/i

/**
 * @param {any} [request] - Express's request.
 * @returns {string | null}
 */
export const getBearerTokenFromRequest = (request) => {
  const authorizationHeader = request?.headers?.authorization
  if (typeof authorizationHeader !== 'string' || !authorizationHeader) {
    return null
  }
  const match = authorizationHeader.match(BEARER_PATTERN)
  return match ? match[1] : null
}

export default getBearerTokenFromRequest
