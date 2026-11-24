import { createHash } from 'node:crypto'
import routeCacheKeyOf from '../../src/register/route/cache/lib/routeCacheKey.js'
import getSessionTokenFromRequest from '../../src/register/route/cache/lib/getSessionTokenFromRequest.js'
import getBearerTokenFromRequest from '../../src/register/route/cache/lib/getBearerTokenFromRequest.js'
import { isSignedInRequest, readerCredentialKindOf, readerKeyPartOf } from '../../src/register/route/cache/lib/readerCredentials.js'
import memoryCache from '../../src/register/route/cache/memory/index.js'

// Who the route cache files a signed-in answer under (owner's Q1961 b, 2026-11-24). @servable/server's user resolver
// (lib/servable/server src/launch/wireSchema/register/routes/utils/userResolver.js) authenticates a request with its
// `Authorization: Bearer <access token>` first when that token verifies, and falls back to the session token
// (`x-servable-session-token`, header, then cookie) otherwise. The cache cannot verify an access token, so a
// signed-in key names every credential the resolver may use: the bearer's digest, the session's digest, or both.

const SESSION_TOKEN = 'r:0123456789abcdef0123456789abcdef'
const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSIsInNpZCI6InMxIn0.c2lnbmF0dXJl'
const INSTALLATION_ID = '7f3c9a10-device-of-the-owner'
const digestOf = (value) => createHash('sha256').update(value).digest('hex').slice(0, 32)

const requestOf = ({ url = '/v1/explore?b=2&a=1', headers = {}, cookies } = {}) => ({ originalUrl: url, headers, cookies })
const signedInKeyOf = (request) => routeCacheKeyOf({ request, template: 'userExists' })

describe('the credentials of a request', () => {
  test('the bearer is read as the user resolver reads it: `Bearer <token>`, any case, any spacing', () => {
    expect(getBearerTokenFromRequest(requestOf({ headers: { authorization: `Bearer ${ACCESS_TOKEN}` } }))).toBe(ACCESS_TOKEN)
    expect(getBearerTokenFromRequest(requestOf({ headers: { authorization: `bearer   ${ACCESS_TOKEN}` } }))).toBe(ACCESS_TOKEN)
    expect(getBearerTokenFromRequest(requestOf({ headers: { authorization: `BEARER ${ACCESS_TOKEN}` } }))).toBe(ACCESS_TOKEN)
  })

  test('another scheme, an empty bearer or no header is no bearer', () => {
    expect(getBearerTokenFromRequest(requestOf({ headers: { authorization: 'Basic dXNlcjpwYXNz' } }))).toBeNull()
    expect(getBearerTokenFromRequest(requestOf({ headers: { authorization: 'Bearer' } }))).toBeNull()
    expect(getBearerTokenFromRequest(requestOf({ headers: { authorization: '' } }))).toBeNull()
    expect(getBearerTokenFromRequest(requestOf())).toBeNull()
    expect(getBearerTokenFromRequest(undefined)).toBeNull()
  })

  test('the session token: the header, then the parsed cookies, then the raw cookie header', () => {
    expect(getSessionTokenFromRequest(requestOf({ headers: { 'x-servable-session-token': 'r:header', cookie: 'x-servable-session-token=r:raw' }, cookies: { 'x-servable-session-token': 'r:parsed' } }))).toBe('r:header')
    expect(getSessionTokenFromRequest(requestOf({ headers: { cookie: 'x-servable-session-token=r:raw' }, cookies: { 'x-servable-session-token': 'r:parsed' } }))).toBe('r:parsed')
    expect(getSessionTokenFromRequest(requestOf({ headers: { cookie: 'theme=dark; x-servable-session-token=r:raw' } }))).toBe('r:raw')
    expect(getSessionTokenFromRequest(requestOf())).toBeNull()
  })

  test('a cookie sent twice: the first one, the one the user resolver (`cookie.parse`) authenticates with', () => {
    expect(getSessionTokenFromRequest(requestOf({ headers: { cookie: 'x-servable-session-token=r:first; x-servable-session-token=r:second' } }))).toBe('r:first')
  })

  test('signed in means carrying a session token or a bearer', () => {
    expect(isSignedInRequest(requestOf())).toBe(false)
    expect(isSignedInRequest(requestOf({ headers: { authorization: 'Basic dXNlcjpwYXNz' } }))).toBe(false)
    expect(isSignedInRequest(requestOf({ headers: { 'x-servable-session-token': SESSION_TOKEN } }))).toBe(true)
    expect(isSignedInRequest(requestOf({ headers: { cookie: `x-servable-session-token=${SESSION_TOKEN}` } }))).toBe(true)
    expect(isSignedInRequest(requestOf({ headers: { authorization: `Bearer ${ACCESS_TOKEN}` } }))).toBe(true)
  })

  test('the kind of credential, a closed list for the counts', () => {
    expect(readerCredentialKindOf(requestOf())).toBeNull()
    expect(readerCredentialKindOf(requestOf({ headers: { 'x-servable-session-token': SESSION_TOKEN } }))).toBe('session')
    expect(readerCredentialKindOf(requestOf({ headers: { authorization: `Bearer ${ACCESS_TOKEN}` } }))).toBe('bearer')
    expect(readerCredentialKindOf(requestOf({ headers: { authorization: `Bearer ${ACCESS_TOKEN}`, 'x-servable-session-token': SESSION_TOKEN } }))).toBe('session_and_bearer')
  })
})

describe('the key of a signed-in answer', () => {
  test('a session token alone: the session namespace and its digest', () => {
    expect(readerKeyPartOf(requestOf({ headers: { 'x-servable-session-token': SESSION_TOKEN } }))).toBe(`s:${digestOf(SESSION_TOKEN)}.i:-`)
    expect(signedInKeyOf(requestOf({ headers: { 'x-servable-session-token': SESSION_TOKEN } }))).toBe(`__express__/v1/explore?a=1&b=2#s:${digestOf(SESSION_TOKEN)}.i:-`)
  })

  test('the header and the cookie carrying the same session share one key', () => {
    expect(signedInKeyOf(requestOf({ headers: { cookie: `x-servable-session-token=${SESSION_TOKEN}` } })))
      .toBe(signedInKeyOf(requestOf({ headers: { 'x-servable-session-token': SESSION_TOKEN } })))
  })

  test('a bearer alone: the bearer namespace and its digest', () => {
    expect(signedInKeyOf(requestOf({ headers: { authorization: `Bearer ${ACCESS_TOKEN}` } }))).toBe(`__express__/v1/explore?a=1&b=2#b:${digestOf(ACCESS_TOKEN)}`)
  })

  test('the same string as a bearer and as a session token never gives the same key', () => {
    const asBearer = signedInKeyOf(requestOf({ headers: { authorization: `Bearer ${SESSION_TOKEN}` } }))
    const asSession = signedInKeyOf(requestOf({ headers: { 'x-servable-session-token': SESSION_TOKEN } }))
    expect(asBearer).not.toBe(asSession)
  })

  test('both: the bearer and the session, since the resolver takes the bearer when it verifies and the session otherwise', () => {
    const both = signedInKeyOf(requestOf({ headers: { authorization: `Bearer ${ACCESS_TOKEN}`, 'x-servable-session-token': SESSION_TOKEN } }))
    expect(both).toBe(`__express__/v1/explore?a=1&b=2#b:${digestOf(ACCESS_TOKEN)}+s:${digestOf(SESSION_TOKEN)}.i:-`)
    // Neither the bearer's entry nor the session's entry is the pair's.
    expect(both).not.toBe(signedInKeyOf(requestOf({ headers: { authorization: `Bearer ${ACCESS_TOKEN}` } })))
    expect(both).not.toBe(signedInKeyOf(requestOf({ headers: { 'x-servable-session-token': SESSION_TOKEN } })))
    // The same bearer with another session is another entry, and the other way round.
    expect(both).not.toBe(signedInKeyOf(requestOf({ headers: { authorization: `Bearer ${ACCESS_TOKEN}`, 'x-servable-session-token': 'r:another' } })))
    expect(both).not.toBe(signedInKeyOf(requestOf({ headers: { authorization: 'Bearer another', 'x-servable-session-token': SESSION_TOKEN } })))
  })

  test('a session carries the device it was sent from: the digest of its installation id, or `-` with none', () => {
    const sessionFrom = (installationId) => requestOf({ headers: { 'x-servable-session-token': SESSION_TOKEN, ...(installationId === undefined ? {} : { 'x-servable-installation-id': installationId }) } })
    expect(readerKeyPartOf(sessionFrom(INSTALLATION_ID))).toBe(`s:${digestOf(SESSION_TOKEN)}.i:${digestOf(INSTALLATION_ID)}`)
    // Two devices, two entries; no device is an entry of its own.
    expect(signedInKeyOf(sessionFrom(INSTALLATION_ID))).not.toBe(signedInKeyOf(sessionFrom('another-device')))
    expect(signedInKeyOf(sessionFrom(INSTALLATION_ID))).not.toBe(signedInKeyOf(sessionFrom(undefined)))
    // An empty header is no device, as the user resolver reads it (its device check skips a falsy id).
    expect(signedInKeyOf(sessionFrom(''))).toBe(signedInKeyOf(sessionFrom(undefined)))
    // The raw id is never in the key.
    expect(signedInKeyOf(sessionFrom(INSTALLATION_ID)).includes(INSTALLATION_ID)).toBe(false)
  })

  test('the device is part of the session only: a bearer alone is keyed without it', () => {
    const bearerFrom = (installationId) => requestOf({ headers: { authorization: `Bearer ${ACCESS_TOKEN}`, 'x-servable-installation-id': installationId } })
    expect(readerKeyPartOf(bearerFrom(INSTALLATION_ID))).toBe(`b:${digestOf(ACCESS_TOKEN)}`)
    expect(signedInKeyOf(bearerFrom(INSTALLATION_ID))).toBe(signedInKeyOf(bearerFrom('another-device')))
    const both = requestOf({ headers: { authorization: `Bearer ${ACCESS_TOKEN}`, 'x-servable-session-token': SESSION_TOKEN, 'x-servable-installation-id': INSTALLATION_ID } })
    expect(readerKeyPartOf(both)).toBe(`b:${digestOf(ACCESS_TOKEN)}+s:${digestOf(SESSION_TOKEN)}.i:${digestOf(INSTALLATION_ID)}`)
  })

  test('two bearers, two keys', () => {
    expect(signedInKeyOf(requestOf({ headers: { authorization: 'Bearer token-of-alice' } })))
      .not.toBe(signedInKeyOf(requestOf({ headers: { authorization: 'Bearer token-of-bob' } })))
  })

  test('no credential: no signed-in key, so the request is not cached by a signed-in configuration', () => {
    expect(readerKeyPartOf(requestOf())).toBeNull()
    expect(signedInKeyOf(requestOf())).toBeNull()
    expect(signedInKeyOf(requestOf({ headers: { authorization: 'Basic dXNlcjpwYXNz' } }))).toBeNull()
  })

  test('no token in any key, only digests', () => {
    const key = signedInKeyOf(requestOf({ headers: { authorization: `Bearer ${ACCESS_TOKEN}`, 'x-servable-session-token': SESSION_TOKEN } }))
    for (const secretPart of [ACCESS_TOKEN, ACCESS_TOKEN.split('.')[0], ACCESS_TOKEN.split('.')[2], SESSION_TOKEN, SESSION_TOKEN.slice(2)]) {
      expect(key.includes(secretPart)).toBe(false)
    }
  })

  test('a configuration that is not per reader keys by the address alone, credentials or not', () => {
    const request = requestOf({ headers: { authorization: `Bearer ${ACCESS_TOKEN}`, 'x-servable-session-token': SESSION_TOKEN } })
    expect(routeCacheKeyOf({ request, template: 'userDoesNotExist' })).toBe('__express__/v1/explore?a=1&b=2')
    expect(routeCacheKeyOf({ request, template: null })).toBe('__express__/v1/explore?a=1&b=2')
  })

  test('the reader part is set apart by a character no address the cache files under can hold', () => {
    // `#` ends a path and is escaped in a query, so a signed-out address can never spell a signed-in key.
    const signedOutKey = routeCacheKeyOf({ request: requestOf({ url: `/v1/explore/x%23s:${digestOf(SESSION_TOKEN)}?q=%23` }), template: null })
    expect(signedOutKey.includes('#')).toBe(false)
    const queryKey = routeCacheKeyOf({ request: requestOf({ url: `/v1/explore?q=a#s:${digestOf(SESSION_TOKEN)}` }), template: null })
    expect(queryKey.includes('#')).toBe(false)
  })
})

describe('the credential counts', () => {
  const recordingMetrics = () => {
    const recorded = []
    return { recorded, counter: (name) => ({ add: (value, attributes) => recorded.push({ name, ...attributes }) }) }
  }
  let metrics
  beforeEach(() => { metrics = recordingMetrics(); globalThis.Servable = { App: { Metrics: metrics } } })
  afterEach(() => { delete globalThis.Servable })

  const lookUp = (middleware, headers) => new Promise((resolve) => {
    const response = { locals: {}, send () { return this }, status () { return this }, setHeader () {}, getHeader () { return null }, statusCode: 200 }
    middleware(requestOf({ headers }), response, resolve)
  })

  test('a signed-in configuration counts which credential keyed each lookup, by storage only', async () => {
    const store = { get: () => null, put: () => {} }
    const middleware = memoryCache({ duration: 60000, template: 'userExists', store, routePath: '/v1/explore' })
    await lookUp(middleware, { 'x-servable-session-token': SESSION_TOKEN })
    await lookUp(middleware, { authorization: `Bearer ${ACCESS_TOKEN}` })
    await lookUp(middleware, { authorization: `Bearer ${ACCESS_TOKEN}`, 'x-servable-session-token': SESSION_TOKEN })
    await lookUp(middleware, {})
    const credentials = metrics.recorded.filter(({ name }) => name === 'servable_route_cache_reader_credentials_total')
    expect(credentials).toEqual([
      { name: 'servable_route_cache_reader_credentials_total', storage: 'inMemory', credential: 'session' },
      { name: 'servable_route_cache_reader_credentials_total', storage: 'inMemory', credential: 'bearer' },
      { name: 'servable_route_cache_reader_credentials_total', storage: 'inMemory', credential: 'session_and_bearer' },
    ])
  })

  test('a configuration that is not per reader counts no credential', async () => {
    const middleware = memoryCache({ duration: 60000, template: null, store: { get: () => null, put: () => {} }, routePath: '/v1/explore' })
    await lookUp(middleware, { authorization: `Bearer ${ACCESS_TOKEN}` })
    expect(metrics.recorded.filter(({ name }) => name === 'servable_route_cache_reader_credentials_total')).toEqual([])
  })
})
