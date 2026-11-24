import express from 'express'
import http from 'http'
import { jest } from '@jest/globals'
import { createClient } from 'redis'
import ParseServer from 'parse-server'
import redisCache from '../../src/register/route/cache/redis/index.js'
import processHttp from '../../src/register/route/process/http.js'
import { hashedSessionTokenOf } from '../../src/register/route/cache/lib/hashSessionToken.js'
import { withSessionTokensHashedInKeys } from '../../src/setConfigurations/adapters/sessionKeyHashing.js'

// The route cache and Parse's own cache against a real Redis (F7, F8, F9): what Redis holds is the answer as sent,
// once, under a key without the session token; an error is never written; Parse's `user:<token>` keys hold a digest.
//
// Uses SERVABLE_TEST_REDIS_URI, defaulting to a scratch Redis on 127.0.0.1:6380; skips when none is reachable. Every
// key it writes starts with a prefix of its own and is deleted at the end.
const REDIS_URI = process.env.SERVABLE_TEST_REDIS_URI || 'redis://127.0.0.1:6380'
const PATH_PREFIX = `/route-cache-test-${process.pid}`

let client = null
try {
  client = createClient({ url: REDIS_URI, socket: { connectTimeout: 2000, reconnectStrategy: false } })
  client.on('error', () => {})
  await client.connect()
} catch {
  client = null
}

const describeIfRedis = client ? describe : describe.skip

const listen = (app) => new Promise((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)) })
const get = (server, path, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: server.address().port, path, headers }, (response) => {
    const chunks = []
    response.on('data', (chunk) => chunks.push(chunk))
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }))
  }).on('error', reject)
})

describeIfRedis('route cache and Parse cache keys (real Redis)', () => {
  let server
  let calls
  const TOKEN = 'r:0123456789abcdef0123456789abcdef'

  beforeAll(async () => {
    calls = { ok: 0, missing: 0 }
    const app = express()
    const cacheOf = (template) => redisCache({ duration: 60000, template, getClient: async () => client })
    const page = { results: Array.from({ length: 20 }, (_, index) => ({ id: index, title: `Titre "${index}" é \\ ü` })) }
    app.get(`${PATH_PREFIX}/ok`, cacheOf('userExists'), (req, res, next) => processHttp({ options: { handler: async () => { calls.ok += 1; return page } }, request: req, response: res, next }))
    app.get(`${PATH_PREFIX}/missing`, cacheOf(null), (req, res, next) => processHttp({ options: { handler: async () => { calls.missing += 1; throw { code: 404, message: 'Not found' } } }, request: req, response: res, next }))
    server = await listen(app)
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    const keys = [...await client.keys(`__express__${PATH_PREFIX}*`), ...await client.keys('route-cache-test:*')]
    if (keys.length > 0) {
      await client.del(keys)
    }
    await client.quit()
  })

  test('a signed-in answer: written once under the token\'s digest, replayed byte for byte', async () => {
    const miss = await get(server, `${PATH_PREFIX}/ok`, { 'x-servable-session-token': TOKEN })
    await new Promise((resolve) => setTimeout(resolve, 50))
    const hit = await get(server, `${PATH_PREFIX}/ok`, { 'x-servable-session-token': TOKEN })
    expect(calls.ok).toBe(1)
    expect(hit.status).toBe(200)
    expect(hit.headers['content-type']).toBe(miss.headers['content-type'])
    expect(Buffer.compare(hit.body, miss.body)).toBe(0)
    const keys = await client.keys(`__express__${PATH_PREFIX}/ok*`)
    expect(keys).toEqual([`__express__${PATH_PREFIX}/ok#s:${hashedSessionTokenOf(TOKEN)}.i:-`])
    const stored = await client.get(keys[0])
    expect(stored.endsWith(`\n${miss.body.toString()}`)).toBe(true)
    expect(Buffer.byteLength(stored) - miss.body.length).toBeLessThan(80)
    const ttl = await client.pTTL(keys[0])
    expect(ttl).toBeGreaterThan(55000)
    expect(ttl).toBeLessThanOrEqual(60000)
  })

  test('a bearer-only answer: written under the bearer\'s digest in its own namespace, never the token (Q1961 b)', async () => {
    const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJl'
    const before = calls.ok
    await get(server, `${PATH_PREFIX}/ok?reader=bearer`, { authorization: `Bearer ${ACCESS_TOKEN}` })
    await new Promise((resolve) => setTimeout(resolve, 50))
    await get(server, `${PATH_PREFIX}/ok?reader=bearer`, { authorization: `Bearer ${ACCESS_TOKEN}` })
    expect(calls.ok - before).toBe(1)
    const keys = await client.keys(`__express__${PATH_PREFIX}/ok?reader=bearer*`)
    expect(keys).toEqual([`__express__${PATH_PREFIX}/ok?reader=bearer#b:${hashedSessionTokenOf(ACCESS_TOKEN)}`])
    expect(keys[0].includes(ACCESS_TOKEN.split('.')[2])).toBe(false)
  })

  test('an error is never written', async () => {
    expect((await get(server, `${PATH_PREFIX}/missing`)).status).toBe(404)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect((await get(server, `${PATH_PREFIX}/missing`)).status).toBe(404)
    expect(calls.missing).toBe(2)
    expect(await client.keys(`__express__${PATH_PREFIX}/missing*`)).toEqual([])
  })

  test('Parse\'s Redis cache adapter writes the digest, never the token, and finds its entries', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
    const Adapter = withSessionTokensHashedInKeys(ParseServer.RedisCacheAdapter)
    const adapter = new Adapter({ url: REDIS_URI }, 60000)
    await adapter.connect?.()
    await adapter.put(`route-cache-test:user:${TOKEN}`, { objectId: 'u1' })
    expect(await adapter.get(`route-cache-test:user:${TOKEN}`)).toEqual({ objectId: 'u1' })
    expect(await client.keys('route-cache-test:*')).toEqual([`route-cache-test:user:${hashedSessionTokenOf(TOKEN)}`])
    await adapter.del(`route-cache-test:user:${TOKEN}`)
    expect(await adapter.get(`route-cache-test:user:${TOKEN}`)).toBeNull()
    await adapter.handleShutdown?.()
    jest.restoreAllMocks()
  })
})
