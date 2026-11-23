import http from 'http'
import { jest } from '@jest/globals'
import createApp from '../../src/createapp/index.js'
import route from '../../src/register/route/index.js'
import { forgetUndeclaredParameterRoutes } from '../../src/register/route/parameters/bootReport.js'

// Typed route parameters through the engine's real Express app (createapp/index.js, its query parser), a route defined by
// `Servable.App.Route.define` (register/route/index.js) and processHttp, over HTTP on a port the system picks. No other
// service is needed.

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
  const send = (method, pathAndQuery, body) => new Promise((resolve, reject) => {
    const sent = http.request({ host: '127.0.0.1', port, path: pathAndQuery, method, headers: { 'content-type': 'application/json' } }, (answer) => {
      let text = ''
      answer.setEncoding('utf8')
      answer.on('data', (chunk) => { text += chunk })
      answer.on('end', () => resolve({ status: answer.statusCode, body: JSON.parse(text) }))
    })
    sent.on('error', reject)
    sent.end(body === undefined ? undefined : JSON.stringify(body))
  })
  const get = (pathAndQuery) => send('GET', pathAndQuery)
  const post = (pathAndQuery, body) => send('POST', pathAndQuery, body)
  return { get, post, routeRegistry, close: () => new Promise((resolve) => server.close(resolve)) }
}

// The handler answers what it was given: its params, and request.query, which must be the same values.
const echoHandler = async ({ params, request }) => ({ params, query: request.query, typeOf: Object.fromEntries(Object.entries(params).map(([name, value]) => [name, Array.isArray(value) ? 'array' : typeof value])) })

const routes = [
  {
    method: 'get',
    path: 'typed',
    schema: {
      queryString: {
        slug: 'string',
        isDraft: { type: 'boolean', default: false },
        page: { type: 'integer', default: 0, minimum: 0 },
        ids: 'string[]',
      },
    },
    handler: echoHandler,
  },
  { method: 'get', path: 'undeclared', handler: echoHandler },
  { method: 'function', path: 'typedfunction', servableArguments: async () => ({ userResolver: async () => null }), schema: { queryString: { count: 'integer' } }, handler: echoHandler },
  { method: 'post', path: 'typedpost', schema: { queryString: { isDryRun: 'boolean' } }, handler: async ({ params, request }) => ({ params, bodyLength: request.body.length }) },
]

describe('typed route parameters over HTTP, guessing on (the default)', () => {
  let server
  beforeAll(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'log').mockImplementation(() => {})
    server = await serverOf({ routes })
  })
  afterAll(async () => {
    await server.close()
    forgetUndeclaredParameterRoutes()
    jest.restoreAllMocks()
  })

  test('a declared route reads each parameter as its type, defaults applied, before the handler', async () => {
    const { status, body } = await server.get('/typed?slug=123&isDraft=YES&page=007&ids=1&ids=2')
    expect(status).toBe(200)
    expect(body.params).toEqual({ slug: '123', isDraft: true, page: 7, ids: ['1', '2'] })
    expect(body.query).toEqual(body.params)
    expect(body.typeOf).toEqual({ slug: 'string', isDraft: 'boolean', page: 'number', ids: 'array' })
    expect((await server.get('/typed')).body.params).toEqual({ isDraft: false, page: 0 })
  })

  test('a value that cannot be read is refused with a 400 naming it, and the handler never runs', async () => {
    const { status, body } = await server.get('/typed?isDraft=maybe&page=-1')
    expect(status).toBe(400)
    expect(body.error).toContain('"isDraft"')
    expect(body.error).toContain('"page"')
  })

  test('a parameter the route does not declare is guessed, as before', async () => {
    const { body } = await server.get('/typed?slug=a&extra=12&flag=true')
    expect(body.params).toEqual({ slug: 'a', isDraft: false, page: 0, extra: 12, flag: true })
  })

  test('a route that declares nothing reads its query string exactly as before', async () => {
    const { body } = await server.get('/undeclared?slug=123&flag=true&text=abc')
    expect(body.params).toEqual({ slug: 123, flag: true, text: 'abc' })
  })

  test('a POST route reads its query string typed and keeps its body raw', async () => {
    const { status, body } = await server.post('/typedpost?isDryRun=on', { a: 1 })
    expect(status).toBe(200)
    expect(body.params).toEqual({ isDryRun: true })
    expect(body.bodyLength).toBe(JSON.stringify({ a: 1 }).length)
  })

  test('a function route reads its query string typed too', async () => {
    expect((await server.post('/function/typedfunction?count=03&other=4', {})).body.params).toEqual({ count: 3, other: 4 })
    expect((await server.post('/function/typedfunction?count=x', {})).status).toBe(400)
  })

  test('the boot report lists the route that declares nothing', () => {
    expect(server.routeRegistry.undeclaredParameterRoutes()).toEqual([{ routeName: 'GET undeclared', doesSeemToReadParameters: true }])
  })
})

describe('typed route parameters over HTTP, guessing switched off', () => {
  let server
  beforeAll(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    server = await serverOf({ engine: { isQueryValueGuessingEnabled: false }, routes })
  })
  afterAll(async () => {
    await server.close()
    forgetUndeclaredParameterRoutes()
    jest.restoreAllMocks()
  })

  test('an undeclared parameter reaches the handler as the text the client sent', async () => {
    expect((await server.get('/undeclared?slug=123&flag=true')).body.params).toEqual({ slug: '123', flag: 'true' })
    expect((await server.get('/typed?extra=12')).body.params).toEqual({ isDraft: false, page: 0, extra: '12' })
  })

  test('declared parameters read the same', async () => {
    expect((await server.get('/typed?isDraft=1&page=2')).body.params).toEqual({ isDraft: true, page: 2 })
  })
})

describe('the refusal of undeclared routes', () => {
  afterEach(() => {
    forgetUndeclaredParameterRoutes()
    jest.restoreAllMocks()
  })

  test('stops a route that reads its parameters and declares none, when guessing is off and the option is on', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(serverOf({ engine: { isQueryValueGuessingEnabled: false, areUndeclaredParameterRoutesRefused: true }, routes: [{ method: 'get', path: 'undeclared', handler: echoHandler }] }))
      .rejects.toThrow('GET undeclared reads its parameters and declares none')
  })

  test('lets it through while guessing is on', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const server = await serverOf({ engine: { areUndeclaredParameterRoutesRefused: true }, routes: [{ method: 'get', path: 'undeclared', handler: echoHandler }] })
    expect((await server.get('/undeclared?a=1')).body.params).toEqual({ a: 1 })
    await server.close()
  })
})
