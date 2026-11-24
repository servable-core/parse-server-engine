import http from 'http'
import { jest } from '@jest/globals'
import createApp from '../../src/createapp/index.js'
import route, { isConnectMethod } from '../../src/register/route/index.js'
import { forgetUndeclaredParameterRoutes } from '../../src/register/route/parameters/bootReport.js'

// The HTTP method a route is defined with (owner's Q1376 a, 2026-11-23). A `connect` route was registered as a HEAD
// route, so a HEAD request on its path ran it in place of the GET route's own HEAD answer (what a probe sends). It is
// now refused at define: Node's HTTP server never hands a CONNECT request to Express. Through the engine's real Express
// app on a loopback port the system picks; no other service is needed.

const servableConfig = { envs: { engineMaxUploadSize: '1mb' }, configuration: { config: { engine: {} } } }

const serverWith = async (routes) => {
  const app = await createApp({ servableConfig })
  global.Servable = { AppNative: app }
  const routeRegistry = route({ servableConfig })
  for (const definition of routes) {
    await routeRegistry.define(definition)
  }
  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = /** @type {import('net').AddressInfo} */ (server.address())
  const send = (method, requestPath) => new Promise((resolve, reject) => {
    const sent = http.request({ host: '127.0.0.1', port, path: requestPath, method }, (answer) => {
      let text = ''
      answer.setEncoding('utf8')
      answer.on('data', (chunk) => { text += chunk })
      answer.on('end', () => resolve({ status: answer.statusCode, headers: answer.headers, text }))
    })
    sent.on('error', reject)
    sent.end()
  })
  return { send, close: () => new Promise((resolve) => server.close(resolve)) }
}

describe('route methods', () => {
  let server
  const probeHandler = jest.fn(async () => ({ isReady: true }))
  const connectHandler = jest.fn(async () => ({ isConnect: true }))
  const headHandler = jest.fn(async () => ({}))

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    server = await serverWith([
      // Defined before the GET route: Express runs the first route matching a HEAD request.
      { method: 'connect', path: 'probe', schema: { queryString: {} }, handler: connectHandler },
      { method: 'get', path: 'probe', schema: { queryString: {} }, handler: probeHandler },
      { method: 'CONNECT', path: 'tunnel', handler: connectHandler },
      { method: 'head', path: 'onlyhead', schema: { queryString: {} }, handler: headHandler },
    ])
  })

  afterAll(async () => {
    await server.close()
    forgetUndeclaredParameterRoutes()
    delete global.Servable
    jest.restoreAllMocks()
  })

  test('a connect route is refused at define, logged with its path, and never fails the boot', () => {
    const logged = console.error.mock.calls.map((parts) => parts.join(' ')).join('\n')
    expect(logged).toContain('CONNECT probe is not defined')
    expect(logged).toContain('CONNECT tunnel is not defined')
    expect(isConnectMethod('Connect')).toBe(true)
    expect(isConnectMethod('get')).toBe(false)
  })

  test('a HEAD request on the path of a GET route gets the GET route\'s answer, never the connect route\'s', async () => {
    const head = await server.send('HEAD', '/probe')
    expect(head.status).toBe(200)
    expect(head.text).toBe('')
    expect(connectHandler).not.toHaveBeenCalled()
    expect(probeHandler).toHaveBeenCalled()
    const get = await server.send('GET', '/probe')
    expect(get.status).toBe(200)
    expect(JSON.parse(get.text)).toMatchObject({ isReady: true })
  })

  test('a connect route\'s path answers nothing of its own', async () => {
    expect((await server.send('HEAD', '/tunnel')).status).toBe(404)
    expect((await server.send('GET', '/tunnel')).status).toBe(404)
    expect(connectHandler).not.toHaveBeenCalled()
  })

  test('a head route is still a HEAD route', async () => {
    expect((await server.send('HEAD', '/onlyhead')).status).toBe(200)
    expect(headHandler).toHaveBeenCalledTimes(1)
  })
})
