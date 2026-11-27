import { jest } from '@jest/globals'
import express from 'express'
import http from 'http'
import { applyTrustProxy } from '../../src/createapp/trustProxy.js'
import createRateLimiter from '../../src/register/route/rateLimiter/index.js'
import requestAdapter from '../../src/register/route/adapters/request.js'
import {
  READER_ADDRESS_HEADER,
  checkedReaderAddressOf,
  plainIpAddressOf,
  readerAddressMiddlewareOf,
  signedReaderAddressHeaderValueOf,
} from '../../src/readerAddress/index.js'
import { readerAddressSecretFrom } from '../../src/options/index.js'

// The signed reader address (.docs/technical/ssr-reader-address-design-2026-11-27.md, owner's Q2309 a): a server rendering
// for readers (web/main) signs each reader's address; the engine believes it only when the signature is the secret's and
// fresh, and counts its limiters on it. Anything else leaves req.ip.

const SECRET = 'a-reader-address-secret-of-the-servers-0123456789'

// The vector web/main's signer is pinned to as well (web/main @servable/nextjs/routes/lib/readerAddress.test.js): the same
// secret, address and time must give this header on both sides.
const SHARED_VECTOR = {
  secret: 'shared-test-vector-secret-0123456789abcdef',
  address: '203.0.113.9',
  nowSeconds: 1764240000,
  headerValue: 'v1;1764240000;203.0.113.9;GHMj7y8NibX1cacAqcwS4xbXkwmQFFX7vUTk7Rb3v4c',
}

describe('the header format', () => {
  test('gives the shared test vector', () => {
    expect(signedReaderAddressHeaderValueOf(SHARED_VECTOR)).toBe(SHARED_VECTOR.headerValue)
    expect(checkedReaderAddressOf({ ...SHARED_VECTOR })).toEqual({ outcome: 'verified', address: '203.0.113.9' })
  })

  test('signs an IPv6 address and an IPv4-mapped one as its IPv4', () => {
    const nowSeconds = 1764240000
    const ipv6 = signedReaderAddressHeaderValueOf({ address: '2001:db8::7', secret: SECRET, nowSeconds })
    expect(checkedReaderAddressOf({ headerValue: ipv6, secret: SECRET, nowSeconds })).toEqual({ outcome: 'verified', address: '2001:db8::7' })
    const mapped = signedReaderAddressHeaderValueOf({ address: '::ffff:198.51.100.4', secret: SECRET, nowSeconds })
    expect(mapped.split(';')[2]).toBe('198.51.100.4')
  })

  test('signs nothing without a secret or for a value that is not an IP address', () => {
    expect(signedReaderAddressHeaderValueOf({ address: '203.0.113.9', secret: '' })).toBeNull()
    expect(signedReaderAddressHeaderValueOf({ address: 'unknown', secret: SECRET })).toBeNull()
    expect(plainIpAddressOf('203.0.113.9; v1')).toBeNull()
  })
})

describe('what a header is believed for', () => {
  const nowSeconds = 1764240000
  const signedAt = (seconds, address = '203.0.113.9') => signedReaderAddressHeaderValueOf({ address, secret: SECRET, nowSeconds: seconds })

  test('no header, or no secret', () => {
    expect(checkedReaderAddressOf({ headerValue: undefined, secret: SECRET, nowSeconds }).outcome).toBe('absent')
    expect(checkedReaderAddressOf({ headerValue: signedAt(nowSeconds), secret: null, nowSeconds }).outcome).toBe('no_secret')
  })

  test('a header that does not parse', () => {
    for (const headerValue of ['203.0.113.9', 'v2;1764240000;203.0.113.9;abc', 'v1;soon;203.0.113.9;abc', 'v1;1764240000;not-an-address;abc', 'v1;1764240000;203.0.113.9;', 'v1;1764240000;::ffff:203.0.113.9;abc', 'x'.repeat(500)]) {
      expect(checkedReaderAddressOf({ headerValue, secret: SECRET, nowSeconds }).outcome).toBe('malformed')
    }
  })

  test('another secret, or an address changed after signing', () => {
    const otherSecret = signedReaderAddressHeaderValueOf({ address: '203.0.113.9', secret: `${SECRET}-other`, nowSeconds })
    expect(checkedReaderAddressOf({ headerValue: otherSecret, secret: SECRET, nowSeconds }).outcome).toBe('refused')
    const changed = signedAt(nowSeconds).replace('203.0.113.9', '203.0.113.10')
    expect(checkedReaderAddressOf({ headerValue: changed, secret: SECRET, nowSeconds }).outcome).toBe('refused')
  })

  test('accepted 60 seconds after signing and 10 before, not beyond', () => {
    expect(checkedReaderAddressOf({ headerValue: signedAt(nowSeconds - 60), secret: SECRET, nowSeconds }).outcome).toBe('verified')
    expect(checkedReaderAddressOf({ headerValue: signedAt(nowSeconds - 61), secret: SECRET, nowSeconds }).outcome).toBe('expired')
    expect(checkedReaderAddressOf({ headerValue: signedAt(nowSeconds + 10), secret: SECRET, nowSeconds }).outcome).toBe('verified')
    expect(checkedReaderAddressOf({ headerValue: signedAt(nowSeconds + 11), secret: SECRET, nowSeconds }).outcome).toBe('expired')
  })
})

describe('the secret, an engine option', () => {
  test('the environment wins over the app, a short one is refused', () => {
    expect(readerAddressSecretFrom({ engineConfiguration: { readerAddressSecret: SECRET }, env: {} })).toBe(SECRET)
    expect(readerAddressSecretFrom({ engineConfiguration: { readerAddressSecret: SECRET }, env: { SERVABLE_READER_ADDRESS_SECRET: `${SECRET}-env` } })).toBe(`${SECRET}-env`)
    expect(readerAddressSecretFrom({ engineConfiguration: {}, env: {} })).toBeNull()
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(readerAddressSecretFrom({ engineConfiguration: {}, env: { SERVABLE_READER_ADDRESS_SECRET: 'too-short' } })).toBeNull()
    consoleError.mockRestore()
  })
})

// Over HTTP, in createApp's order: trust proxy, the reader address middleware, then a route with a fixedByIp limiter.
const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server))
})

const requestFrom = (server, headers = {}) => new Promise((resolve, reject) => {
  const request = http.request({ host: '127.0.0.1', port: server.address().port, path: '/', headers }, (response) => {
    let body = ''
    response.on('data', (chunk) => { body += chunk })
    response.on('end', () => resolve({ status: response.statusCode, body }))
  })
  request.on('error', reject)
  request.end()
})

describe('a route of the engine behind the middleware', () => {
  let server
  afterEach(() => new Promise((resolve) => (server ? server.close(resolve) : resolve())))

  const appWith = async ({ secret, trustProxy }) => {
    const app = express()
    applyTrustProxy({ app, rawValue: trustProxy })
    app.use(readerAddressMiddlewareOf({ secret }))
    app.get('/',
      createRateLimiter({ rateLimiting: { type: 'fixedByIp', params: { limit: 2, window: 60 * 1000 } } }),
      (request, response) => response.send(requestAdapter({ request }).readerAddress))
    server = await listen(app)
    return server
  }
  const signed = (address) => ({ [READER_ADDRESS_HEADER]: signedReaderAddressHeaderValueOf({ address, secret: SECRET }) })

  test('two readers signed through one caller are counted apart', async () => {
    await appWith({ secret: SECRET })
    expect((await requestFrom(server, signed('203.0.113.1'))).body).toBe('203.0.113.1')
    expect((await requestFrom(server, signed('203.0.113.1'))).status).toBe(200)
    expect((await requestFrom(server, signed('203.0.113.1'))).status).toBe(429)
    // The same caller's socket, another reader: its own bucket.
    const otherReader = await requestFrom(server, signed('203.0.113.2'))
    expect(otherReader).toEqual({ status: 200, body: '203.0.113.2' })
  })

  test('a forged header, or no secret, counts the request under its own address', async () => {
    await appWith({ secret: SECRET })
    const forged = { [READER_ADDRESS_HEADER]: signedReaderAddressHeaderValueOf({ address: '203.0.113.1', secret: `${SECRET}-guess` }) }
    expect((await requestFrom(server, forged)).body).toMatch(/127\.0\.0\.1/)
    await new Promise((resolve) => server.close(resolve))
    await appWith({ secret: null })
    expect((await requestFrom(server, signed('203.0.113.1'))).body).toMatch(/127\.0\.0\.1/)
  })

  test('with one trusted proxy hop and no header, the visitor of X-Forwarded-For, as before', async () => {
    await appWith({ secret: SECRET, trustProxy: '1' })
    expect((await requestFrom(server, { 'x-forwarded-for': '198.51.100.7' })).body).toBe('198.51.100.7')
  })
})
