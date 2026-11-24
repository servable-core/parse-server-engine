import getBearerTokenFromRequest from './getBearerTokenFromRequest.js'
import getSessionTokenFromRequest from './getSessionTokenFromRequest.js'
import { hashedCredentialOf } from './hashSessionToken.js'

// Who a signed-in answer of the route cache belongs to (owner's Q1961 b, 2026-11-24).
//
// @servable/server's user resolver (lib/servable/server src/launch/wireSchema/register/routes/utils/userResolver.js)
// authenticates a request with its access token (`Authorization: Bearer <JWT>`) first, when the server has a JWT
// secret, the token verifies and its user still exists; with the session token (`x-servable-session-token`, header or
// cookie) otherwise. Until this change the cache read the session token only: a request signed in with a bearer alone
// was anonymous to it (served the shared signed-out answer, or never cached), and a bearer of one reader sent with the
// session of another was filed under that session.
//
// The cache cannot tell whether the bearer will verify (it holds no JWT secret, and verifying belongs to the server),
// so a signed-in key names every credential the resolver may authenticate with:
//   - a session token alone: `s:<digest>.i:<device>` (the device: below)
//   - a bearer alone: `b:<digest>`
//   - both: `b:<digest>+s:<digest>.i:<device>`; whichever the resolver picks, an entry is only ever served to a request carrying
//     the very same two credentials, so it reaches no one who could not have had that answer anyway.
// The namespaces keep a bearer's digest from ever standing for a session's (the same string sent both ways gives two
// keys). Digests only, never a token (./hashSessionToken.js).
//
// A session also carries the device it was sent from (owner's Q1971 b): with the legacy device binding on
// (authConfig.legacySessionDeviceBindingEnabled, AUTH_LEGACY_SESSION_DEVICE_BINDING), the resolver answers anonymously
// a session sent with an `x-servable-installation-id` other than the one its `_Session` is bound to, and lets through a
// missing id. So the session's part is `s:<digest>.i:<digest of the installation id>`, or `.i:-` when the request sends
// none (an empty header is none, as the resolver reads it): a wrong-device request is filed apart and never fills the
// owner's entry. The access-token path checks no device, so a bearer's part has none. Digests only, never the id.
//
// "Signed in", for the cache's templates (`userExists`, `userDoesNotExist`, ../index.js), is carrying one of them: the
// same rule as the key, so a signed-in configuration always has a key to file the answer under.

/**
 * @param {any} request - Express's request.
 * @returns {{ sessionToken: string | null, bearerToken: string | null }}
 */
export const readerCredentialsOf = (request) => ({
  sessionToken: getSessionTokenFromRequest(request) || null,
  bearerToken: getBearerTokenFromRequest(request),
})

/**
 * The device a request says it was sent from, read as the user resolver reads it (`x-servable-installation-id`), or
 * null when it sends none.
 * @param {any} request
 * @returns {string | null}
 */
export const installationIdOf = (request) => {
  const installationId = request?.headers?.['x-servable-installation-id']
  return installationId ? String(installationId) : null
}

/**
 * @param {any} request
 * @returns {boolean}
 */
export const isSignedInRequest = (request) => {
  const { sessionToken, bearerToken } = readerCredentialsOf(request)
  return Boolean(sessionToken || bearerToken)
}

/**
 * Which credentials the request carries, a closed list for the counts (routeCacheCounts.js): never a value.
 * @param {any} request
 * @returns {'session' | 'bearer' | 'session_and_bearer' | null}
 */
export const readerCredentialKindOf = (request) => {
  const { sessionToken, bearerToken } = readerCredentialsOf(request)
  if (sessionToken && bearerToken) {
    return 'session_and_bearer'
  }
  if (bearerToken) {
    return 'bearer'
  }
  return sessionToken ? 'session' : null
}

/**
 * The reader's part of a signed-in key, or null when the request carries no credential.
 * @param {any} request
 * @returns {string | null}
 */
export const readerKeyPartOf = (request) => {
  const { sessionToken, bearerToken } = readerCredentialsOf(request)
  const parts = []
  if (bearerToken) {
    parts.push(`b:${hashedCredentialOf(bearerToken)}`)
  }
  if (sessionToken) {
    const installationId = installationIdOf(request)
    parts.push(`s:${hashedCredentialOf(sessionToken)}.i:${installationId ? hashedCredentialOf(installationId) : '-'}`)
  }
  return parts.length > 0 ? parts.join('+') : null
}
