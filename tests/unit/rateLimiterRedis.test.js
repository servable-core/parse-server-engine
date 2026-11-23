import express from 'express'
import http from 'http'
import { jest } from '@jest/globals'
import createRateLimiter from '../../src/register/route/rateLimiter/index.js'
import RedisRateLimitStore from '../../src/register/route/rateLimiter/redisStore.js'

// A Redis that runs the store's two scripts as the server would, with a clock the test moves.
const fakeRedisOf = (clock) => {
  const entries = new Map()
  const live = (key) => (entries.has(key) && entries.get(key).expiresAt > clock.now ? entries.get(key) : null)
  const state = { isDown: false, isSlow: false, evalCount: 0 }
  return {
    state,
    client: {
      eval: async (script, { keys: [key], arguments: args }) => {
        state.evalCount += 1
        if (state.isDown) throw new Error('Redis is down')
        if (state.isSlow) await new Promise(() => {})
        if (script.includes('INCR')) {
          let entry = live(key)
          if (!entry) { entry = { hits: 0, expiresAt: clock.now + Number(args[0]) }; entries.set(key, entry) }
          entry.hits += 1
          return [entry.hits, entry.expiresAt - clock.now]
        }
        const entry = live(key)
        if (!entry) return 0
        entry.hits -= 1
        return entry.hits
      },
      del: async (key) => { entries.delete(key) },
    },
    keys: () => [...entries.keys()],
  }
}

const listen = (app) => new Promise((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)) })
const get = (server, path = '/a') => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: server.address().port, path }, (response) => {
    let body = ''
    response.on('data', (chunk) => { body += chunk })
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }))
  }).on('error', reject)
})

// A "pod": an app with one limiter on one route, its store built on the shared fake Redis.
const podOf = async ({ redis, limit = 2, window = 60000, routeKey = 'get:/a', message = 'Too many' }) => {
  const app = express()
  const limiter = createRateLimiter({ rateLimiting: { type: 'fixedByIp', params: { limit, window, message } }, routeKey })
  app.get('/a', limiter, (req, res) => res.send('ok'))
  return listen(app)
}

describe('rate limiter, Redis store', () => {
  let clock
  let redis
  let servers
  const originalEnv = { ...process.env }
  beforeEach(() => {
    clock = { now: 1_000_000 }
    redis = fakeRedisOf(clock)
    servers = []
    process.env.SERVABLE_RATE_LIMIT_REDIS = '1'
  })
  afterEach(async () => {
    process.env = { ...originalEnv }
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
    jest.restoreAllMocks()
  })

  const storeOf = (overrides = {}) => new RedisRateLimitStore({ routeKey: 'get:/a', getClient: async () => redis.client, now: () => clock.now, ...overrides })

  test('two limiter instances sharing one Redis count together', async () => {
    const options = { windowMs: 60000 }
    const podA = storeOf(); podA.init(options)
    const podB = storeOf(); podB.init(options)
    expect((await podA.increment('1.2.3.4')).totalHits).toBe(1)
    expect((await podB.increment('1.2.3.4')).totalHits).toBe(2)
    expect((await podA.increment('1.2.3.4')).totalHits).toBe(3)
    expect((await podB.increment('5.6.7.8')).totalHits).toBe(1)
  })

  test('each route has its own counter (prefix per limiter)', async () => {
    const a = storeOf({ routeKey: 'get:/a' }); a.init({ windowMs: 60000 })
    const b = storeOf({ routeKey: 'post:/b' }); b.init({ windowMs: 60000 })
    await a.increment('ip'); await a.increment('ip')
    expect((await b.increment('ip')).totalHits).toBe(1)
    expect(redis.keys().sort()).toEqual(['servable:ratelimit:get:/a:ip', 'servable:ratelimit:post:/b:ip'])
  })

  test('the window resets after windowMs', async () => {
    const store = storeOf(); store.init({ windowMs: 60000 })
    await store.increment('ip'); await store.increment('ip')
    clock.now += 60001
    const afterWindow = await store.increment('ip')
    expect(afterWindow.totalHits).toBe(1)
    expect(afterWindow.resetTime.getTime()).toBe(clock.now + 60000)
  })

  test('decrement takes one hit back, resetKey clears the visitor', async () => {
    const store = storeOf(); store.init({ windowMs: 60000 })
    await store.increment('ip'); await store.increment('ip')
    await store.decrement('ip')
    expect((await store.increment('ip')).totalHits).toBe(2)
    await store.resetKey('ip')
    expect((await store.increment('ip')).totalHits).toBe(1)
  })

  test('Redis down: falls back to memory, the request is not blocked, logged once', async () => {
    redis.state.isDown = true
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    const store = storeOf(); store.init({ windowMs: 60000 })
    expect((await store.increment('ip')).totalHits).toBe(1)
    expect((await store.increment('ip')).totalHits).toBe(2)
    expect(consoleError).toHaveBeenCalledTimes(1)
    // The breaker is open: Redis is not asked again for a few seconds.
    expect(redis.state.evalCount).toBe(1)
    clock.now += 61000
    await store.increment('ip')
    expect(consoleError).toHaveBeenCalledTimes(2)
  })

  test('a Redis that does not answer falls back after the command timeout', async () => {
    redis.state.isSlow = true
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const store = storeOf({ commandTimeoutMs: 20 }); store.init({ windowMs: 60000 })
    expect((await store.increment('ip')).totalHits).toBe(1)
  })

  test('no Redis client (connection failed): in-memory fallback', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const store = storeOf({ getClient: async () => null }); store.init({ windowMs: 60000 })
    expect((await store.increment('ip')).totalHits).toBe(1)
  })

  test('default (env unset): no Redis store, in-memory counting as before', async () => {
    delete process.env.SERVABLE_RATE_LIMIT_REDIS
    const server = await podOf({ redis, limit: 2 }); servers.push(server)
    expect((await get(server)).status).toBe(200)
    expect((await get(server)).status).toBe(200)
    expect((await get(server)).status).toBe(429)
    expect(redis.state.evalCount).toBe(0)
  })

  test('enabled but with no routeKey: in-memory store', async () => {
    const app = express()
    app.get('/a', createRateLimiter({ rateLimiting: { type: 'fixedByIp', params: { limit: 1, window: 60000 } } }), (req, res) => res.send('ok'))
    const server = await listen(app); servers.push(server)
    expect((await get(server)).status).toBe(200)
    expect((await get(server)).status).toBe(429)
  })

  test('the limiter over HTTP keeps its message, status and RateLimit-* headers with the Redis store', async () => {
    // The Redis store needs the module's own client: here the real getRedisClient is replaced by building the limiter around a store.
    const { default: rateLimit } = await import('express-rate-limit')
    const app = express()
    const store = storeOf()
    app.get('/a', rateLimit({ store, windowMs: 60000, max: 1, message: 'Too many here', standardHeaders: true, legacyHeaders: true }), (req, res) => res.send('ok'))
    const server = await listen(app); servers.push(server)
    const first = await get(server)
    expect(first.status).toBe(200)
    expect(first.headers['ratelimit-limit']).toBe('1')
    expect(first.headers['ratelimit-remaining']).toBe('0')
    expect(first.headers['x-ratelimit-limit']).toBe('1')
    const second = await get(server)
    expect(second.status).toBe(429)
    expect(second.body).toBe('Too many here')
    expect(second.headers['retry-after']).toBeDefined()
  })
})
