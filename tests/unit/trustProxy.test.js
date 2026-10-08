import express from 'express'
import http from 'http'
import { trustProxySettingFrom, applyTrustProxy } from '../../src/createapp/trustProxy.js'
import createRateLimiter from '../../src/register/route/rateLimiter/index.js'

// A request as ingress-nginx forwards it: the socket is the proxy (here, loopback) and the visitor is
// named in X-Forwarded-For.
const requestFrom = (server, { forwardedFor, path = '/' } = {}) => new Promise((resolve, reject) => {
  const { port } = server.address()
  const request = http.request({
    host: '127.0.0.1', port, path,
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
  }, (response) => {
    let body = ''
    response.on('data', (chunk) => { body += chunk })
    response.on('end', () => resolve({ status: response.statusCode, body }))
  })
  request.on('error', reject)
  request.end()
})

const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server))
})

describe('trustProxySettingFrom', () => {
  test('leaves Express alone when unset or empty', () => {
    expect(trustProxySettingFrom(undefined)).toBeUndefined()
    expect(trustProxySettingFrom('')).toBeUndefined()
    expect(trustProxySettingFrom('  ')).toBeUndefined()
  })

  test('reads a hop count as a number, booleans as booleans, anything else as a list', () => {
    expect(trustProxySettingFrom('1')).toBe(1)
    expect(trustProxySettingFrom('true')).toBe(true)
    expect(trustProxySettingFrom('false')).toBe(false)
    expect(trustProxySettingFrom('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8')
  })
})

describe('the client address behind one proxy hop', () => {
  let server
  afterEach(() => new Promise((resolve) => (server ? server.close(resolve) : resolve())))

  test('without trust proxy, req.ip is the proxy', async () => {
    const app = express()
    applyTrustProxy({ app, rawValue: undefined })
    app.get('/', (req, res) => res.send(req.ip))
    server = await listen(app)

    const { body } = await requestFrom(server, { forwardedFor: '203.0.113.7' })
    expect(body).toMatch(/127\.0\.0\.1/)
  })

  test('with SERVABLE_ENGINE_TRUST_PROXY=1, req.ip is the visitor', async () => {
    const app = express()
    applyTrustProxy({ app, rawValue: '1' })
    app.get('/', (req, res) => res.send(req.ip))
    server = await listen(app)

    const { body } = await requestFrom(server, { forwardedFor: '203.0.113.7' })
    expect(body).toBe('203.0.113.7')
  })

  test('with SERVABLE_ENGINE_TRUST_PROXY=1, the rate limiter gives each visitor their own bucket', async () => {
    const app = express()
    applyTrustProxy({ app, rawValue: '1' })
    app.get('/', createRateLimiter({ rateLimiting: { type: 'fixedByIp', params: { limit: 1, window: 60000 } } }),
      (req, res) => res.send('ok'))
    server = await listen(app)

    expect((await requestFrom(server, { forwardedFor: '203.0.113.7' })).status).toBe(200)
    expect((await requestFrom(server, { forwardedFor: '203.0.113.7' })).status).toBe(429)
    // A different visitor through the same proxy is not blocked by the first one's requests.
    expect((await requestFrom(server, { forwardedFor: '198.51.100.9' })).status).toBe(200)
  })
})
