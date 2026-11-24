import express from 'express'
import http from 'http'
import redisCache from '../../src/register/route/cache/redis/index.js'
import memoryCache from '../../src/register/route/cache/memory/index.js'
import processHttp from '../../src/register/route/process/http.js'

// Production proof 3.4 (.docs/technical/production-proof-instrumentation-2026-11-23.md): each lookup and each store of the
// route cache, counted through Servable.App.Metrics by route, storage and outcome. Nothing is counted (and nothing throws)
// when the installed @servable/server has no Servable.App.Metrics.

const SECRET = 'a-bypass-secret-of-the-server-0123'

const recordingMetrics = () => {
  const recorded = []
  return { recorded, counter: (name) => ({ add: (value, attributes) => recorded.push({ name, ...attributes }) }) }
}

const fakeRedis = ({ isWriteFailing = false } = {}) => {
  const entries = new Map()
  return {
    get: async (key) => entries.get(key) ?? null,
    set: async (key, value) => {
      if (isWriteFailing) throw new Error('redis full')
      entries.set(key, value)
    },
  }
}
const fakeMemory = () => {
  const entries = new Map()
  return { get: (key) => entries.get(key) ?? null, put: (key, value) => entries.set(key, value) }
}

const listen = (app) => new Promise((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)) })
const ask = (server, headers = {}) => new Promise((resolve, reject) => {
  const outgoing = http.request({ host: '127.0.0.1', port: server.address().port, path: '/v1/a', headers }, (response) => {
    response.resume()
    response.on('end', () => resolve(response.statusCode))
  })
  outgoing.on('error', reject)
  outgoing.end()
})
const appWith = async ({ cacheMiddleware, handler = async () => ({ ok: true }), beforeCache }) => {
  const app = express()
  app.get('/v1/a', (req, res, next) => { beforeCache?.(req); next() }, cacheMiddleware, async (req, res, next) => {
    await processHttp({ options: { handler }, request: req, response: res, next })
  })
  return listen(app)
}

const STORES = {
  redis: (props, client = fakeRedis()) => redisCache({ ...props, getClient: async () => client }),
  inMemory: (props) => memoryCache({ ...props, store: fakeMemory() }),
}

let metrics
let servers
beforeEach(() => { metrics = recordingMetrics(); globalThis.Servable = { App: { Metrics: metrics } }; servers = [] })
afterEach(async () => {
  delete globalThis.Servable
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
})
const start = async (props) => { const server = await appWith(props); servers.push(server); return server }
const lookups = () => metrics.recorded.filter(({ name }) => name === 'servable_route_cache_lookups_total').map(({ outcome }) => outcome)
const stores = () => metrics.recorded.filter(({ name }) => name === 'servable_route_cache_stores_total').map(({ outcome }) => outcome)

describe.each(Object.keys(STORES))('the %s store, counted', (storage) => {
  test('a miss kept, then a hit, labelled by the route and the storage (the healthy path)', async () => {
    const server = await start({ cacheMiddleware: STORES[storage]({ duration: 60000, routePath: '/v1/a' }) })
    await ask(server)
    await ask(server)
    expect(lookups()).toEqual(['miss', 'hit'])
    expect(stores()).toEqual(['stored'])
    expect(metrics.recorded.every((point) => point.route === '/v1/a' && point.storage === storage)).toBe(true)
  })

  test('an error answer is not_cacheable; the secret and the flag are bypasses; a wrong header is refused, then served as usual', async () => {
    const failing = await start({ cacheMiddleware: STORES[storage]({ duration: 60000, routePath: '/v1/a' }), handler: async () => { throw { code: 404, message: 'no' } } })
    await ask(failing)
    expect(stores()).toEqual(['not_cacheable'])
    metrics.recorded.length = 0

    const server = await start({
      cacheMiddleware: STORES[storage]({ duration: 60000, routePath: '/v1/a', bypassSecret: SECRET }),
      beforeCache: (req) => { if (req.headers['x-app-says-fresh']) req.shouldBypassTheRouteCache = true },
    })
    await ask(server, { 'x-servable-reset-cache': SECRET })
    await ask(server, { 'x-app-says-fresh': '1' })
    await ask(server, { 'x-servable-reset-cache': '1' })
    expect(lookups()).toEqual(['bypass_secret', 'bypass_in_process', 'bypass_refused', 'miss'])
    expect(JSON.stringify(metrics.recorded)).not.toContain(SECRET)
  })
})

describe('the Redis store, when Redis fails', () => {
  test('no client is no_client; a failed write is write_failed (the alarm paths)', async () => {
    const withoutClient = await start({ cacheMiddleware: redisCache({ duration: 60000, routePath: '/v1/a', getClient: async () => null }) })
    await ask(withoutClient)
    const failingWrites = await start({ cacheMiddleware: STORES.redis({ duration: 60000, routePath: '/v1/a' }, fakeRedis({ isWriteFailing: true })) })
    const consoleError = console.error
    console.error = () => {}
    await ask(failingWrites)
    await new Promise((resolve) => setImmediate(resolve))
    console.error = consoleError
    expect(lookups()).toEqual(['no_client', 'miss'])
    expect(stores()).toEqual(['write_failed'])
  })
})

describe('without Servable.App.Metrics', () => {
  test('the cache works and nothing is counted', async () => {
    globalThis.Servable = { App: {} }
    const server = await start({ cacheMiddleware: STORES.inMemory({ duration: 60000, routePath: '/v1/a' }) })
    expect(await ask(server)).toBe(200)
    expect(await ask(server)).toBe(200)
    expect(metrics.recorded).toEqual([])
  })
})
