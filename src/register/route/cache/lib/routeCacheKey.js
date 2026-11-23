import getSessionTokenFromRequest from './getSessionTokenFromRequest.js'
import { hashedSessionTokenOf } from './hashSessionToken.js'
import { normalizeRequestUrl } from './normalizeRequestUrl.js'

const KEY_PREFIX = '__express__'

/**
 * The key a route's answer is cached under, the same for both stores: the normalized address, and for a
 * `userExists` configuration (one entry per signed-in session) the digest of the session token, never the token.
 * Null when the configuration is per session and the request carries none: such a request is not cached.
 * @param {object} props
 * @param {any} props.request - Express's request.
 * @param {string | null | undefined} props.template
 * @returns {string | null}
 */
export const routeCacheKeyOf = ({ request, template }) => {
  const key = KEY_PREFIX + normalizeRequestUrl(request?.originalUrl || request?.url)
  if (String(template || '').trim().toLowerCase() !== 'userexists') {
    return key
  }
  const sessionToken = getSessionTokenFromRequest(request)
  if (!sessionToken) {
    return null
  }
  return `${key}_${hashedSessionTokenOf(sessionToken)}`
}

export default routeCacheKeyOf
