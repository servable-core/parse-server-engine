import { createHash } from 'node:crypto'

// A session token never appears in a key the engine writes anywhere (Redis, memory): only this digest of it
// (framework performance audit 2026-11-23, F9). A key name is listed by `SCAN`/`KEYS`/`MONITOR`, copied into
// slow logs and backups, and read by anyone with access to the cache; a bearer token there is a session to steal.
// 32 hexadecimal characters (128 bits) of SHA-256: no two live sessions share one, and it cannot be turned back
// into the token. Keys written before this change held the raw token; they are never read again and expire with
// their window.

const HASHED_TOKEN_LENGTH = 32

/**
 * @param {string} sessionToken
 * @returns {string}
 */
export const hashedSessionTokenOf = (sessionToken) =>
  createHash('sha256').update(String(sessionToken)).digest('hex').slice(0, HASHED_TOKEN_LENGTH)

export default hashedSessionTokenOf
