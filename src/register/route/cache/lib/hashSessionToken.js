import { createHash } from 'node:crypto'

// A credential (a session token, an access token sent as a bearer) never appears in a key the engine writes anywhere
// (Redis, memory): only this digest of it (framework performance audit 2026-11-23, F9; owner's Q1961 b for the
// bearer). A key name is listed by `SCAN`/`KEYS`/`MONITOR`, copied into slow logs and backups, and read by anyone with
// access to the cache; a bearer token there is a session to steal. 32 hexadecimal characters (128 bits) of SHA-256:
// no two live credentials share one, and it cannot be turned back into the token. Keys written before this change
// held the raw token; they are never read again and expire with their window. The route cache keeps a session's
// digest and a bearer's in namespaces of their own (./readerCredentials.js).

const HASHED_TOKEN_LENGTH = 32

/**
 * @param {string} credential - a session token or an access token.
 * @returns {string}
 */
export const hashedCredentialOf = (credential) =>
  createHash('sha256').update(String(credential)).digest('hex').slice(0, HASHED_TOKEN_LENGTH)

/**
 * The digest of a session token (Parse's own `user:<token>` cache keys use it too, sessionKeyHashing.js).
 * @param {string} sessionToken
 * @returns {string}
 */
export const hashedSessionTokenOf = (sessionToken) => hashedCredentialOf(sessionToken)

export default hashedSessionTokenOf
