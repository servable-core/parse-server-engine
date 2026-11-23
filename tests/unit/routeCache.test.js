import express from 'express'
import http from 'http'
import { jest } from '@jest/globals'
import mcache from 'memory-cache'
import redisCache from '../../src/register/route/cache/redis/index.js'
import memoryCache from '../../src/register/route/cache/memory/index.js'
import createCache from '../../src/register/route/cache/index.js'
import processHttp from '../../src/register/route/process/http.js'
import { hashedSessionTokenOf } from '../../src/register/route/cache/lib/hashSessionToken.js'
import { answerOfRedisEntry, redisEntryOf } from '../../src/register/route/cache/lib/cachedAnswer.js'
import { isTheBypassSecret } from '../../src/register/route/cache/lib/bypass.js'
import { routeCacheBypassSecretFrom } from '../../src/options/index.js'

// The route cache, both stores, through a real Express app and processHttp (framework performance audit 2026-11-23,
// F7, F8, F9; owner's Q1094 a and Q1095 a): only successes are kept, replayed with their status, Content-Type and
// bytes; one write per miss, the body serialized once; no session token in any key; the bypass only with the
// server's secret or the in-process request flag.

const SECRET = 'a-bypass-secret-of-the-server-0123'
const SESSION_TOKEN = 'r:0123456789abcdef0123456789abcdef'

// A Redis with `get` and `set` (PX), counting writes, with a clock the test moves.
const fakeRedisOf = () => {
  const clock = { now: 1_000_000 }
  const entries = new Map()
  const state = { setCount: 0, lastTtl: null }
  return {
    clock,
    state,
    entries,
    client: {
      get: async (key) => {
        const entry = entries.get(key)
        return entry && entry.expiresAt > clock.now ? entry.value : null
      },
      set: async (key, value, { PX }) => {
        state.setCount += 1
        state.lastTtl = PX
        entries.set(key, { value, expiresAt: clock.now + PX })
      },
    },
  }
}

// A memory-cache lookalike with the same clock, so both stores are driven the same way.
const fakeMemoryOf = () => {
  const clock = { now: 1_000_000 }
  const entries = new Map()
  const state = { setCount: 0, lastTtl: null }
  return {
    clock,
    state,
    entries,
    store: {
      get: (key) => {
        const entry = entries.get(key)
        return entry && entry.expiresAt > clock.now ? entry.value : null
      },
      put: (key, value, ttl) => {
        state.setCount += 1
        state.lastTtl = ttl
        entries.set(key, { value, expiresAt: clock.now + ttl })
      },
    },
  }
}

const STORES = {
  redis: () => {
    const fake = fakeRedisOf()
    return { ...fake, middlewareOf: (props) => redisCache({ ...props, getClient: async () => fake.client }) }
  },
  memory: () => {
    const fake = fakeMemoryOf()
    return { ...fake, middlewareOf: (props) => memoryCache({ ...props, store: fake.store }) }
  },
}

const listen = (app) => new Promise((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)) })
const request = (server, { path = '/a', headers = {}, method = 'GET' } = {}) => new Promise((resolve, reject) => {
  const outgoing = http.request({ host: '127.0.0.1', port: server.address().port, path, headers, method }, (response) => {
    const chunks = []
    response.on('data', (chunk) => chunks.push(chunk))
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }))
  })
  outgoing.on('error', reject)
  outgoing.end()
})

// An app with one cached route whose handler the test writes, behind processHttp like every real route.
const appOf = async ({ cacheMiddleware, handler, beforeCache }) => {
  const app = express()
  const calls = { count: 0 }
  app.get('/a',
    (req, res, next) => { beforeCache?.(req); next() },
    cacheMiddleware,
    async (req, res, next) => {
      calls.count += 1
      await processHttp({ options: { handler: (props) => handler({ ...props, calls }) }, request: req, response: res, next })
    })
  const server = await listen(app)
  return { server, calls }
}

describe.each(Object.keys(STORES))('route cache, %s store', (storeName) => {
  let store
  let servers
  beforeEach(() => {
    store = STORES[storeName]()
    servers = []
  })
  afterEach(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
  })
  const start = async (props) => {
    const pod = await appOf(props)
    servers.push(pod.server)
    return pod
  }

  test('a 200 is replayed byte for byte, with its status and Content-Type, from one write', async () => {
    const page = { results: [{ id: 'x', title: 'Élan "quoted" \\ back' }], time: 12 }
    const { server, calls } = await start({ cacheMiddleware: store.middlewareOf({ duration: 60000 }), handler: async () => page })
    const miss = await request(server)
    const hit = await request(server)
    expect(calls.count).toBe(1)
    expect(store.state.setCount).toBe(1)
    expect(hit.status).toBe(200)
    expect(hit.status).toBe(miss.status)
    expect(hit.headers['content-type']).toBe(miss.headers['content-type'])
    expect(miss.headers['content-type']).toMatch(/^application\/json/)
    expect(Buffer.compare(hit.body, miss.body)).toBe(0)
    expect(JSON.parse(hit.body.toString())).toEqual(page)
  })

  test('a success other than 200 keeps its status', async () => {
    const { server, calls } = await start({
      cacheMiddleware: store.middlewareOf({ duration: 60000 }),
      handler: async ({ response }) => { response.status(203).json({ isPartial: true }) },
    })
    const miss = await request(server)
    const hit = await request(server)
    expect(calls.count).toBe(1)
    expect(miss.status).toBe(203)
    expect(hit.status).toBe(203)
    expect(hit.body.toString()).toBe(miss.body.toString())
  })

  test.each([
    ['a thrown 404', { code: 404, message: 'Not found' }, 404],
    ['a thrown Error (500)', new Error('boom'), 500],
    ['a Parse code in the 200s (209, invalid session)', { code: 209, message: 'invalid session token' }, 209],
  ])('%s is never kept', async (_name, thrown, expectedStatus) => {
    const { server, calls } = await start({
      cacheMiddleware: store.middlewareOf({ duration: 60000 }),
      handler: async () => { throw thrown },
    })
    const first = await request(server)
    const second = await request(server)
    expect(first.status).toBe(expectedStatus)
    expect(second.status).toBe(expectedStatus)
    expect(calls.count).toBe(2)
    expect(store.state.setCount).toBe(0)
  })

  test('an error answer sent by the handler itself (a 429, a 4xx) is never kept', async () => {
    const { server, calls } = await start({
      cacheMiddleware: store.middlewareOf({ duration: 60000 }),
      handler: async ({ response }) => { response.status(429).send('Too many requests') },
    })
    await request(server)
    const second = await request(server)
    expect(second.status).toBe(429)
    expect(calls.count).toBe(2)
    expect(store.state.setCount).toBe(0)
  })

  test('the entry lives for the window, then the handler runs again', async () => {
    const { server, calls } = await start({ cacheMiddleware: store.middlewareOf({ duration: 10000 }), handler: async () => ({ a: 1 }) })
    await request(server)
    expect(store.state.lastTtl).toBe(10000)
    store.clock.now += 9999
    await request(server)
    expect(calls.count).toBe(1)
    store.clock.now += 2
    await request(server)
    expect(calls.count).toBe(2)
  })

  test('a window that is not a positive number keeps nothing', async () => {
    for (const duration of [0, -5, Number.NaN]) {
      const { server, calls } = await start({ cacheMiddleware: store.middlewareOf({ duration }), handler: async () => ({ a: 1 }) })
      await request(server)
      await request(server)
      expect(calls.count).toBe(2)
    }
    expect(store.state.setCount).toBe(0)
  })

  test('a userExists entry is keyed by the digest of the session token, never the token', async () => {
    const { server, calls } = await start({ cacheMiddleware: store.middlewareOf({ duration: 60000, template: 'userExists' }), handler: async () => ({ a: 1 }) })
    await request(server, { headers: { 'x-servable-session-token': SESSION_TOKEN } })
    await request(server, { headers: { cookie: `x-servable-session-token=${SESSION_TOKEN}` } })
    expect(calls.count).toBe(1)
    const keys = [...store.entries.keys()]
    expect(keys).toEqual([`__express__/a_${hashedSessionTokenOf(SESSION_TOKEN)}`])
    expect(keys.some((key) => key.includes(SESSION_TOKEN) || key.includes(SESSION_TOKEN.slice(2)))).toBe(false)
    // Another session has its own entry.
    await request(server, { headers: { 'x-servable-session-token': 'r:another' } })
    expect(calls.count).toBe(2)
  })

  test('a userExists configuration does not cache a request without a session', async () => {
    const { server, calls } = await start({ cacheMiddleware: store.middlewareOf({ duration: 60000, template: 'userExists' }), handler: async () => ({ a: 1 }) })
    await request(server)
    await request(server)
    expect(calls.count).toBe(2)
    expect(store.state.setCount).toBe(0)
  })

  describe('bypass', () => {
    const warmEntryThenAsk = async ({ bypassSecret, headers, beforeCache }) => {
      let version = 0
      const { server, calls } = await start({
        cacheMiddleware: store.middlewareOf({ duration: 60000, bypassSecret }),
        handler: async () => ({ version: ++version }),
        beforeCache: (req) => beforeCache?.(req),
      })
      await request(server)
      const asked = await request(server, { headers })
      return { calls, asked: JSON.parse(asked.body.toString()) }
    }

    test('the header without a configured secret is ignored: the cache answers', async () => {
      const { calls, asked } = await warmEntryThenAsk({ bypassSecret: null, headers: { 'x-servable-reset-cache': '1' } })
      expect(calls.count).toBe(1)
      expect(asked.version).toBe(1)
    })

    test('the header with a wrong value is ignored', async () => {
      const { calls } = await warmEntryThenAsk({ bypassSecret: SECRET, headers: { 'x-servable-reset-cache': '1' } })
      expect(calls.count).toBe(1)
    })

    test('the header with the secret skips the read and the write', async () => {
      const { calls, asked } = await warmEntryThenAsk({ bypassSecret: SECRET, headers: { 'x-servable-reset-cache': SECRET } })
      expect(calls.count).toBe(2)
      expect(asked.version).toBe(2)
      expect(store.state.setCount).toBe(1)
    })

    test('the request flag set in the process skips it, with no secret at all', async () => {
      const { calls, asked } = await warmEntryThenAsk({
        bypassSecret: null,
        headers: { 'x-app-says-fresh': '1' },
        beforeCache: (req) => { if (req.headers['x-app-says-fresh']) req.shouldBypassTheRouteCache = true },
      })
      expect(calls.count).toBe(2)
      expect(asked.version).toBe(2)
      expect(store.state.setCount).toBe(1)
    })

    test('a truthy flag that is not `true` does not skip it', async () => {
      const { calls } = await warmEntryThenAsk({ bypassSecret: null, headers: {}, beforeCache: (req) => { req.shouldBypassTheRouteCache = '1' } })
      expect(calls.count).toBe(1)
    })
  })
})

describe('route cache, Redis entries', () => {
  test('an entry written by an older engine (JSON envelope) is a miss, replaced, never replayed', async () => {
    const fake = fakeRedisOf()
    fake.entries.set('__express__/a', { value: JSON.stringify({ __servable_cache_entry__: true, body: '{"error":"Not found"}' }), expiresAt: Infinity })
    const app = express()
    let count = 0
    app.get('/a', redisCache({ duration: 60000, getClient: async () => fake.client }), (req, res) => { count += 1; res.json({ fresh: true }) })
    const server = await listen(app)
    const first = await request(server)
    const second = await request(server)
    await new Promise((resolve) => server.close(resolve))
    expect(JSON.parse(first.body.toString())).toEqual({ fresh: true })
    expect(second.body.toString()).toBe(first.body.toString())
    expect(count).toBe(1)
  })

  test('the body is stored once, as sent: no JSON inside JSON', () => {
    const body = JSON.stringify({ results: Array.from({ length: 20 }, (_, index) => ({ id: index, text: 'a "b" \\ c'.repeat(50) })) })
    const entry = redisEntryOf({ status: 200, contentType: 'application/json; charset=utf-8', body })
    const olderEntry = JSON.stringify({ __servable_cache_entry__: true, body })
    expect(entry.endsWith(`\n${body}`)).toBe(true)
    expect(entry.length - body.length).toBeLessThan(80)
    // The older envelope escaped every quote and backslash of the body a second time.
    expect(olderEntry.length).toBeGreaterThan(body.length * 1.1)
    expect(answerOfRedisEntry(entry)).toEqual({ status: 200, contentType: 'application/json; charset=utf-8', body })
  })

  test('a Buffer body comes back as the same bytes', () => {
    const body = Buffer.from([0, 1, 2, 250, 251, 255, 10, 13])
    const answer = answerOfRedisEntry(redisEntryOf({ status: 200, contentType: 'application/octet-stream', body }))
    expect(Buffer.isBuffer(answer.body)).toBe(true)
    expect(Buffer.compare(answer.body, body)).toBe(0)
  })

  test('an entry claiming a non-success status, or damaged, is never replayed', () => {
    expect(answerOfRedisEntry('SRC2 {"s":404,"t":null,"e":"utf8"}\n{}')).toBeNull()
    expect(answerOfRedisEntry('SRC2 {not json\n{}')).toBeNull()
    expect(answerOfRedisEntry('SRC2 {"s":200}')).toBeNull()
    expect(answerOfRedisEntry(null)).toBeNull()
  })
})

describe('route cache, factory and options', () => {
  // The factory test uses the real memory-cache, whose expiry timers would keep Jest alive.
  afterAll(() => mcache.clear())

  test('the factory hands the secret to the store of each configuration', async () => {
    const middleware = createCache({ cache: { configurations: [{ storage: 'memory', window: 60000 }] }, bypassSecret: SECRET })
    const app = express()
    let count = 0
    app.get('/factory-a', middleware, (req, res) => { count += 1; res.json({ count }) })
    const server = await listen(app)
    await request(server, { path: '/factory-a' })
    await request(server, { path: '/factory-a', headers: { 'x-servable-reset-cache': '1' } })
    await request(server, { path: '/factory-a', headers: { 'x-servable-reset-cache': SECRET } })
    await new Promise((resolve) => server.close(resolve))
    expect(count).toBe(2)
  })

  test('the secret is compared whole, whatever its length', () => {
    expect(isTheBypassSecret(SECRET, SECRET)).toBe(true)
    expect(isTheBypassSecret(SECRET.slice(0, -1), SECRET)).toBe(false)
    expect(isTheBypassSecret(`${SECRET}x`, SECRET)).toBe(false)
    expect(isTheBypassSecret('', SECRET)).toBe(false)
    expect(isTheBypassSecret(undefined, SECRET)).toBe(false)
    expect(isTheBypassSecret(SECRET, null)).toBe(false)
  })

  test('the secret comes from the environment first, then the app; a short one is refused', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(routeCacheBypassSecretFrom({ env: {} })).toBeNull()
    expect(routeCacheBypassSecretFrom({ env: {}, engineConfiguration: { routeCacheBypassSecret: SECRET } })).toBe(SECRET)
    expect(routeCacheBypassSecretFrom({ env: { SERVABLE_CACHE_BYPASS_SECRET: `${SECRET}-env` }, engineConfiguration: { routeCacheBypassSecret: SECRET } })).toBe(`${SECRET}-env`)
    expect(routeCacheBypassSecretFrom({ env: { SERVABLE_CACHE_BYPASS_SECRET: 'short' } })).toBeNull()
    expect(console.error).toHaveBeenCalledTimes(1)
    console.error.mockRestore()
  })
})
