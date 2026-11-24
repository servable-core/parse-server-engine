import http from 'http'
import { jest } from '@jest/globals'
import createApp from '../../src/createapp/index.js'
import route from '../../src/register/route/index.js'
import { forgetUndeclaredParameterRoutes } from '../../src/register/route/parameters/bootReport.js'

// Declared bodies (owner's Q1720 a, 2026-11-24) through the engine's real Express app, routes defined by
// `Servable.App.Route.define` (register/route/index.js), processHttp and the function verb, over HTTP on a port the
// system picks. No other service is needed.

const servableConfigOf = (engine = {}) => ({ envs: { engineMaxUploadSize: '1mb' }, configuration: { config: { engine } } })

const serverOf = async ({ engine = {}, routes }) => {
  const servableConfig = servableConfigOf(engine)
  const app = await createApp({ servableConfig })
  global.Servable = { AppNative: app }
  const routeRegistry = route({ servableConfig })
  for (const definition of routes) {
    await routeRegistry.define(definition)
  }
  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = /** @type {import('net').AddressInfo} */ (server.address())
  // Node's own http client: the engine supports Node 20, where fetch is still experimental.
  const send = (method, pathAndQuery, rawBody, contentType = 'application/json') => new Promise((resolve, reject) => {
    const sent = http.request({ host: '127.0.0.1', port, path: pathAndQuery, method, headers: { 'content-type': contentType } }, (answer) => {
      let text = ''
      answer.setEncoding('utf8')
      answer.on('data', (chunk) => { text += chunk })
      answer.on('end', () => resolve({ status: answer.statusCode, body: JSON.parse(text) }))
    })
    sent.on('error', reject)
    sent.end(rawBody)
  })
  const post = (pathAndQuery, body) => send('POST', pathAndQuery, body === undefined ? undefined : JSON.stringify(body))
  return { send, post, close: () => new Promise((resolve) => server.close(resolve)) }
}

// The handler answers what it was given: the body as the adapter hands it, and the raw body Express kept.
const echoHandler = async ({ params, request, native }) => ({
  params,
  body: Buffer.isBuffer(request.body) ? { isRaw: true, text: request.body.toString('utf8') } : request.body,
  isNativeBodyRaw: Buffer.isBuffer(native.request.body),
})

const signInWithBody = {
  provider: { type: 'string', maxLength: 20 },
  idToken: { type: 'string', maxLength: 8192 },
  locale: { type: 'string', maxLength: 35 },
  timeZone: { type: 'string', maxLength: 50 },
  installation: 'object',
  rememberMe: { type: 'boolean', default: false },
}

const routes = [
  { method: 'post', path: 'declaredbody', schema: { queryString: { isDryRun: 'boolean' }, body: signInWithBody }, handler: echoHandler },
  { method: 'post', path: 'undeclaredbody', schema: { queryString: {} }, handler: echoHandler },
  {
    method: 'function',
    path: 'declaredbodyfunction',
    servableArguments: async () => ({ userResolver: async () => null }),
    schema: { body: { count: { type: 'integer', minimum: 1 } } },
    handler: echoHandler,
  },
  {
    method: 'post',
    path: 'userrequired',
    requireUser: true,
    servableArguments: async () => ({ userResolver: jest.fn(async () => null) }),
    schema: { body: { name: { type: 'string', maxLength: 5 } } },
    handler: echoHandler,
  },
]

describe('declared bodies over HTTP (the option on, its default)', () => {
  let server
  beforeAll(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'info').mockImplementation(() => {})
    server = await serverOf({ routes })
  })
  afterAll(async () => {
    await server.close()
    forgetUndeclaredParameterRoutes()
    jest.restoreAllMocks()
  })

  test('a declared body reaches the handler checked, its defaults applied; Express keeps the raw body', async () => {
    const { status, body } = await server.post('/declaredbody?isDryRun=yes', { provider: 'google', idToken: 'a.b.c', locale: 'fr-FR', installation: { deviceType: 'web' } })
    expect(status).toBe(200)
    expect(body.params).toEqual({ isDryRun: true })
    expect(body.body).toEqual({ provider: 'google', idToken: 'a.b.c', locale: 'fr-FR', installation: { deviceType: 'web' }, rememberMe: false })
    expect(body.isNativeBodyRaw).toBe(true)
  })

  test('a value beyond its limit is refused with a 400 in the shape of every route error, the handler never run', async () => {
    const tooLongLocale = 'fr-'.repeat(40)
    const { status, body } = await server.post('/declaredbody', { provider: 'google', locale: tooLongLocale })
    expect(status).toBe(400)
    expect(body).toEqual({ error: 'Invalid body: "locale": expected at most 35 characters, got text of 120 characters', code: 400 })
    expect(JSON.stringify(body)).not.toContain(tooLongLocale)
  })

  test('a value of the wrong JSON type is refused, never converted', async () => {
    const { status, body } = await server.post('/declaredbody', { rememberMe: 'true' })
    expect(status).toBe(400)
    expect(body.error).toBe('Invalid body: "rememberMe": expected true or false, got text of 4 characters')
  })

  test('a body that is not JSON is refused; an empty one reads as {}', async () => {
    expect(await server.send('POST', '/declaredbody', '{"provider":')).toEqual({ status: 400, body: { error: 'Invalid body: not JSON', code: 400 } })
    const empty = await server.post('/declaredbody')
    expect(empty.status).toBe(200)
    expect(empty.body.body).toEqual({ rememberMe: false })
  })

  test('a body of another content type is not read by bodyParser.raw, and reads as empty', async () => {
    const { status, body } = await server.send('POST', '/declaredbody', 'provider=google', 'text/plain')
    expect(status).toBe(200)
    expect(body.body).toEqual({ rememberMe: false })
  })

  test('a route that declares no body gets it raw, any length, as before', async () => {
    const longText = 'x'.repeat(5000)
    const { status, body } = await server.post('/undeclaredbody', { locale: longText })
    expect(status).toBe(200)
    expect(body.body).toEqual({ isRaw: true, text: JSON.stringify({ locale: longText }) })
  })

  test('the function verb checks its declared body too', async () => {
    expect((await server.post('/function/declaredbodyfunction', { count: 2 })).body.body).toEqual({ count: 2 })
    expect(await server.post('/function/declaredbodyfunction', { count: 0 })).toEqual({ status: 400, body: { error: 'Invalid body: "count": expected 1 or more, got a number', code: 400 } })
  })

  test('a refused body is answered before the user is resolved', async () => {
    const { status, body } = await server.post('/userrequired', { name: 'far too long' })
    expect(status).toBe(400)
    expect(body.code).toBe(400)
  })
})

describe('declared bodies over HTTP, the option off (the kill switch)', () => {
  let server
  beforeAll(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'info').mockImplementation(() => {})
    server = await serverOf({ engine: { areDeclaredRouteBodiesChecked: false }, routes: [routes[0]] })
  })
  afterAll(async () => {
    await server.close()
    forgetUndeclaredParameterRoutes()
    jest.restoreAllMocks()
  })

  test('every schema.body is ignored and the handler gets the raw body, as before', async () => {
    const tooLongLocale = 'x'.repeat(120)
    const { status, body } = await server.post('/declaredbody', { locale: tooLongLocale })
    expect(status).toBe(200)
    expect(body.body).toEqual({ isRaw: true, text: JSON.stringify({ locale: tooLongLocale }) })
  })
})
