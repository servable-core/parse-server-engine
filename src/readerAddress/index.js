import { createHmac, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { engineCounterNamed } from '../lib/metrics.js'

// The reader's address, established once per request (design: .docs/technical/ssr-reader-address-design-2026-11-27.md,
// owner's Q2309 a). A server that renders pages for readers (web/main) calls this server for them, so the request's own
// address (`req.ip`) is that server's, the same for every reader: a limit counted on it is one bucket for all of them.
// Such a server sends the reader's address in `x-servable-reader-address`, signed with a secret only it and this server
// hold (engine option `readerAddressSecret`, environment `SERVABLE_READER_ADDRESS_SECRET`, ../options/index.js):
//
//   x-servable-reader-address: v1;<signed at, Unix seconds>;<address>;<signature>
//   signature = base64url(HMAC-SHA256(secret, "v1\n<signed at>\n<address>"))
//
// A signature is accepted for READER_ADDRESS_MAXIMUM_AGE_SECONDS after it was made, and up to
// READER_ADDRESS_MAXIMUM_CLOCK_AHEAD_SECONDS before (two servers' clocks). Anything else (no header, no secret, a header
// that does not parse, a value that is not an IP address, another signature, an expired one) leaves the request's own
// address, `req.ip`: never a refusal, never a log line per request. The outcome is counted, never the address.

export const READER_ADDRESS_HEADER = 'x-servable-reader-address'
export const READER_ADDRESS_FORMAT_VERSION = 'v1'
export const READER_ADDRESS_MAXIMUM_AGE_SECONDS = 60
export const READER_ADDRESS_MAXIMUM_CLOCK_AHEAD_SECONDS = 10
// Where the middleware keeps what it established, on Express's request.
export const READER_ADDRESS_REQUEST_PROPERTY = 'servableReaderAddress'
export const IS_READER_ADDRESS_SIGNED_REQUEST_PROPERTY = 'isServableReaderAddressSigned'
const MOST_HEADER_CHARACTERS = 200
const FIELD_SEPARATOR = ';'

const checksCounter = engineCounterNamed('servable_reader_address_checks_total', {
  description: 'Count of requests carrying a signed reader address, by outcome (verified, no_secret, malformed, refused, expired).',
})

/**
 * An IP address as it is counted: an IPv4-mapped IPv6 address (`::ffff:203.0.113.9`) as its IPv4. Null when the value is
 * not an IP address. Pure.
 * @param {unknown} value
 * @returns {string | null}
 */
export const plainIpAddressOf = (value) => {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  const withoutMappedPrefix = /^::ffff:/i.test(trimmed) && isIP(trimmed.slice(7)) === 4 ? trimmed.slice(7) : trimmed
  return isIP(withoutMappedPrefix) ? withoutMappedPrefix : null
}

/**
 * The signature of an address signed at a time. Pure.
 * @param {{ address: string, signedAtSeconds: number, secret: string }} props
 * @returns {string}
 */
export const readerAddressSignatureOf = ({ address, signedAtSeconds, secret }) =>
  createHmac('sha256', secret).update(`${READER_ADDRESS_FORMAT_VERSION}\n${signedAtSeconds}\n${address}`, 'utf8').digest('base64url')

/**
 * The header's value for an address, signed now. Null when there is no secret or the address is not an IP address.
 * What a server that calls this one sends (web/main writes its own copy of this, pinned by the same test vector).
 * @param {{ address: string, secret: string | null | undefined, nowSeconds?: number }} props
 * @returns {string | null}
 */
export const signedReaderAddressHeaderValueOf = ({ address, secret, nowSeconds = Math.floor(Date.now() / 1000) }) => {
  const plainAddress = plainIpAddressOf(address)
  if (!secret || !plainAddress) {
    return null
  }
  const signature = readerAddressSignatureOf({ address: plainAddress, signedAtSeconds: nowSeconds, secret })
  return [READER_ADDRESS_FORMAT_VERSION, nowSeconds, plainAddress, signature].join(FIELD_SEPARATOR)
}

/**
 * @param {string} given
 * @param {string} expected
 * @returns {boolean}
 */
const isSameSignature = (given, expected) => {
  const givenBuffer = Buffer.from(given, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  return givenBuffer.length === expectedBuffer.length && timingSafeEqual(givenBuffer, expectedBuffer)
}

/**
 * What a header's value says, checked. `address` is set only when the outcome is `verified`. Pure.
 * @param {{ headerValue: unknown, secret: string | null | undefined, nowSeconds?: number }} props
 * @returns {{ outcome: 'absent' | 'no_secret' | 'malformed' | 'refused' | 'expired' | 'verified', address: string | null }}
 */
export const checkedReaderAddressOf = ({ headerValue, secret, nowSeconds = Math.floor(Date.now() / 1000) }) => {
  const value = Array.isArray(headerValue) ? headerValue[0] : headerValue
  if (value === undefined || value === null || value === '') {
    return { outcome: 'absent', address: null }
  }
  if (!secret) {
    return { outcome: 'no_secret', address: null }
  }
  if (typeof value !== 'string' || value.length > MOST_HEADER_CHARACTERS) {
    return { outcome: 'malformed', address: null }
  }
  const fields = value.trim().split(FIELD_SEPARATOR)
  if (fields.length !== 4 || fields[0] !== READER_ADDRESS_FORMAT_VERSION || !/^\d{1,12}$/.test(fields[1])) {
    return { outcome: 'malformed', address: null }
  }
  const [, signedAtText, address, signature] = fields
  // Only an address written as it is signed: a mapped or padded one is another text, so another signature.
  if (plainIpAddressOf(address) !== address || !signature) {
    return { outcome: 'malformed', address: null }
  }
  const signedAtSeconds = Number(signedAtText)
  const expectedSignature = readerAddressSignatureOf({ address, signedAtSeconds, secret })
  if (!isSameSignature(signature, expectedSignature)) {
    return { outcome: 'refused', address: null }
  }
  const ageSeconds = nowSeconds - signedAtSeconds
  if (ageSeconds > READER_ADDRESS_MAXIMUM_AGE_SECONDS || ageSeconds < -READER_ADDRESS_MAXIMUM_CLOCK_AHEAD_SECONDS) {
    return { outcome: 'expired', address: null }
  }
  return { outcome: 'verified', address }
}

/**
 * The address a request is counted under: the signed reader's, when the middleware verified one, else the request's own.
 * @param {any} request - Express's request.
 * @returns {string}
 */
export const readerAddressOfRequest = (request) =>
  request?.[READER_ADDRESS_REQUEST_PROPERTY]
  || plainIpAddressOf(request?.ip)
  || request?.ip
  || request?.socket?.remoteAddress
  || 'unknown'

/**
 * The Express middleware that establishes the reader's address of every request, installed once, before every route
 * (createapp/index.js). Never fails a request.
 * @param {{ secret: string | null | undefined, now?: () => number }} props
 * @returns {(request: any, response: any, next: () => void) => void}
 */
export const readerAddressMiddlewareOf = ({ secret, now = () => Date.now() }) => (request, response, next) => {
  try {
    const { outcome, address } = checkedReaderAddressOf({
      headerValue: request?.headers?.[READER_ADDRESS_HEADER],
      secret,
      nowSeconds: Math.floor(now() / 1000),
    })
    if (outcome !== 'absent') {
      checksCounter.add(1, { outcome })
    }
    request[IS_READER_ADDRESS_SIGNED_REQUEST_PROPERTY] = outcome === 'verified'
    request[READER_ADDRESS_REQUEST_PROPERTY] = address || readerAddressOfRequest({ ip: request.ip, socket: request.socket })
  } catch {
    // The request's own address then stands, as when nothing is sent.
  }
  next()
}

export default readerAddressMiddlewareOf
