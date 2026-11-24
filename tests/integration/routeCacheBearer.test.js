import http from 'http'
import { jest } from '@jest/globals'
import mcache from 'memory-cache'
import createApp from '../../src/createapp/index.js'
import route from '../../src/register/route/index.js'
import { forgetUndeclaredParameterRoutes } from '../../src/register/route/parameters/bootReport.js'

// A reader signed in with an access token (`Authorization: Bearer <JWT>`, what web/main's browser client and API clients
// send) through the route cache (owner's Q1961 b, 2026-11-24): the engine's real Express app (createapp/index.js), routes
// defined by `Servable.App.Route.define` with a `cache` declaration, processHttp, over HTTP. Until then the cache read
// only the session token: a bearer-only request was anonymous to it, and served the shared signed-out answer.
//
// The user resolver here does what @servable/server's does (src/launch/wireSchema/register/routes/utils/userResolver.js):
// the bearer first when it verifies, the session token otherwise. No other service is needed (the memory store).

const USER_OF_VERIFIED_ACCESS_TOKEN = { 'jwt-alice': 'alice', 'jwt-bob': 'bob' }
const USER_OF_SESSION_TOKEN = { 'r:carol': 'carol', 'r:alice': 'alice', 'r:dana': 'dana' }
// The device a session is bound to (`installationId` on `_Session`), checked by the resolver when the legacy device binding
// is on (authConfig.legacySessionDeviceBindingEnabled): a different id sent with the session answers anonymously; a
// missing one, or a session bound to none, passes.
const INSTALLATION_ID_OF_SESSION_TOKEN = { 'r:dana': 'device-of-dana' }

const userResolverLikeTheServers = async ({ request }) => {
  const match = String(request.headers?.authorization || '').match(/^Bearer\s+(.+)$/i)
  const userIdOfBearer = match ? USER_OF_VERIFIED_ACCESS_TOKEN[match[1]] : null
  if (userIdOfBearer) {
    return { id: userIdOfBearer }
  }
  const sessionToken = request.headers?.['x-servable-session-token']
  const userIdOfSession = USER_OF_SESSION_TOKEN[sessionToken]
  const boundInstallationId = INSTALLATION_ID_OF_SESSION_TOKEN[sessionToken]
  const installationId = request.headers?.['x-servable-installation-id']
  if (boundInstallationId && installationId && boundInstallationId !== installationId) {
    return null
  }
  return userIdOfSession ? { id: userIdOfSession } : null
}

const servableConfig = { envs: { engineMaxUploadSize: '1mb' }, configuration: { config: { engine: {} } } }
const ONE_HOUR = 60 * 60 * 1000

const calls = { explore: 0, mine: 0 }
const readerAnswerOf = (routeName) => async ({ user }) => {
  calls[routeName] += 1
  return { reader: user?.id ?? null, call: calls[routeName] }
}

const routes = [
  {
    // A route with a signed-out answer shared by everyone, and one answer per signed-in reader (explore, slugable content).
    method: 'get',
    path: 'bearer-cache/explore',
    cache: { configurations: [{ storage: 'memory', window: ONE_HOUR, template: 'userDoesNotExist' }, { storage: 'memory', window: 60000, template: 'userExists' }] },
    servableArguments: async () => ({ userResolver: userResolverLikeTheServers }),
    handler: readerAnswerOf('explore'),
  },
  {
    // A route cached for signed-in readers only.
    method: 'get',
    path: 'bearer-cache/mine',
    cache: { configurations: [{ storage: 'memory', window: 60000, template: 'userExists' }] },
    servableArguments: async () => ({ userResolver: userResolverLikeTheServers }),
    handler: readerAnswerOf('mine'),
  },
]

let server
let port
const get = (path, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path, headers }, (answer) => {
    let text = ''
    answer.setEncoding('utf8')
    answer.on('data', (chunk) => { text += chunk })
    answer.on('end', () => resolve({ status: answer.statusCode, body: JSON.parse(text) }))
  }).on('error', reject)
})
const bearer = (token) => ({ authorization: `Bearer ${token}` })

beforeAll(async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'log').mockImplementation(() => {})
  const app = await createApp({ servableConfig })
  global.Servable = { AppNative: app }
  const routeRegistry = route({ servableConfig })
  for (const definition of routes) {
    await routeRegistry.define(definition)
  }
  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = /** @type {import('net').AddressInfo} */ (server.address()).port
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  mcache.clear()
  forgetUndeclaredParameterRoutes()
  delete global.Servable
  jest.restoreAllMocks()
})

beforeEach(() => {
  mcache.clear()
  calls.explore = 0
  calls.mine = 0
})

describe('a route with a shared signed-out answer', () => {
  test('a bearer request is never served the signed-out entry: it gets its own reader\'s answer', async () => {
    expect((await get('/bearer-cache/explore')).body).toEqual({ reader: null, call: 1 })
    expect((await get('/bearer-cache/explore', bearer('jwt-alice'))).body).toEqual({ reader: 'alice', call: 2 })
    // The signed-out entry is still everyone else's.
    expect((await get('/bearer-cache/explore')).body).toEqual({ reader: null, call: 1 })
  })

  test('a bearer\'s answer is cached for that bearer', async () => {
    expect((await get('/bearer-cache/explore', bearer('jwt-alice'))).body).toEqual({ reader: 'alice', call: 1 })
    expect((await get('/bearer-cache/explore', bearer('jwt-alice'))).body).toEqual({ reader: 'alice', call: 1 })
    expect(calls.explore).toBe(1)
  })

  test('two bearers never share an entry', async () => {
    expect((await get('/bearer-cache/explore', bearer('jwt-alice'))).body).toEqual({ reader: 'alice', call: 1 })
    expect((await get('/bearer-cache/explore', bearer('jwt-bob'))).body).toEqual({ reader: 'bob', call: 2 })
    expect((await get('/bearer-cache/explore', bearer('jwt-alice'))).body).toEqual({ reader: 'alice', call: 1 })
    expect((await get('/bearer-cache/explore', bearer('jwt-bob'))).body).toEqual({ reader: 'bob', call: 2 })
  })

  test('a signed-out request is never served a bearer\'s entry', async () => {
    expect((await get('/bearer-cache/explore', bearer('jwt-alice'))).body).toEqual({ reader: 'alice', call: 1 })
    expect((await get('/bearer-cache/explore')).body).toEqual({ reader: null, call: 2 })
  })

  test('a valid bearer with another reader\'s session: answered as the bearer, and that answer never reaches the session alone', async () => {
    expect((await get('/bearer-cache/explore', { ...bearer('jwt-alice'), 'x-servable-session-token': 'r:carol' })).body).toEqual({ reader: 'alice', call: 1 })
    expect((await get('/bearer-cache/explore', { 'x-servable-session-token': 'r:carol' })).body).toEqual({ reader: 'carol', call: 2 })
  })

  test('an access token that no longer verifies, with a session: answered as the session, and that answer never reaches the bearer alone', async () => {
    expect((await get('/bearer-cache/explore', { ...bearer('jwt-expired-alice'), 'x-servable-session-token': 'r:carol' })).body).toEqual({ reader: 'carol', call: 1 })
    expect((await get('/bearer-cache/explore', bearer('jwt-expired-alice'))).body).toEqual({ reader: null, call: 2 })
  })

  test('a session token alone is cached per session, as before', async () => {
    expect((await get('/bearer-cache/explore', { 'x-servable-session-token': 'r:carol' })).body).toEqual({ reader: 'carol', call: 1 })
    expect((await get('/bearer-cache/explore', { cookie: 'x-servable-session-token=r:carol' })).body).toEqual({ reader: 'carol', call: 1 })
    expect((await get('/bearer-cache/explore')).body).toEqual({ reader: null, call: 2 })
  })
})

describe('a session sent from a device (the legacy device binding)', () => {
  const dana = (installationId) => ({ 'x-servable-session-token': 'r:dana', ...(installationId ? { 'x-servable-installation-id': installationId } : {}) })

  test('the session from the wrong device is answered anonymously, and that answer never reaches the owner\'s device', async () => {
    expect((await get('/bearer-cache/explore', dana('device-of-someone-else'))).body).toEqual({ reader: null, call: 1 })
    expect((await get('/bearer-cache/explore', dana('device-of-dana'))).body).toEqual({ reader: 'dana', call: 2 })
    expect((await get('/bearer-cache/explore', dana('device-of-dana'))).body).toEqual({ reader: 'dana', call: 2 })
  })

  test('the same session from two devices: two entries', async () => {
    expect((await get('/bearer-cache/mine', dana('device-of-dana'))).body).toEqual({ reader: 'dana', call: 1 })
    expect((await get('/bearer-cache/mine', dana('device-of-someone-else'))).body).toEqual({ reader: null, call: 2 })
    expect((await get('/bearer-cache/mine', dana('device-of-dana'))).body).toEqual({ reader: 'dana', call: 1 })
  })

  test('the session with no device id is an entry of its own', async () => {
    expect((await get('/bearer-cache/mine', dana('device-of-someone-else'))).body).toEqual({ reader: null, call: 1 })
    expect((await get('/bearer-cache/mine', dana(null))).body).toEqual({ reader: 'dana', call: 2 })
    expect((await get('/bearer-cache/mine', dana(null))).body).toEqual({ reader: 'dana', call: 2 })
  })
})

describe('a route cached for signed-in readers only', () => {
  test('a bearer request is cached for that bearer (it used to have no key and was never cached)', async () => {
    expect((await get('/bearer-cache/mine', bearer('jwt-alice'))).body).toEqual({ reader: 'alice', call: 1 })
    expect((await get('/bearer-cache/mine', bearer('jwt-alice'))).body).toEqual({ reader: 'alice', call: 1 })
    expect((await get('/bearer-cache/mine', bearer('jwt-bob'))).body).toEqual({ reader: 'bob', call: 2 })
  })

  test('a request with no credential is still never cached', async () => {
    expect((await get('/bearer-cache/mine')).body).toEqual({ reader: null, call: 1 })
    expect((await get('/bearer-cache/mine')).body).toEqual({ reader: null, call: 2 })
  })
})
