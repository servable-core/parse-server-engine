import express from 'express'
import http from 'http'
import processHttp from '../../src/register/route/process/http.js'
import empty from '../../src/register/route/empty.js'
import { ROUTE_DURATION_BUCKETS_IN_SECONDS, isRouteDurationMeasured, routeDurationMiddlewareOf, statusClassOf } from '../../src/register/route/duration/index.js'

// A route that declares `metrics.isDurationMeasured` is measured from its first middleware to its answer (owner's Q1580 a,
// 2026-11-24): servable_route_duration_seconds{route, method, status_class}, through Servable.App.Metrics. A route that does
// not declare it gets the pass-through: nothing recorded, no cost.

const recordingMetrics = () => {
  const recorded = []
  return {
    recorded,
    counter: () => ({ add: () => {} }),
    histogram: (name, options) => ({ record: (value, attributes) => recorded.push({ name, value, attributes, options }) }),
  }
}

const listen = (app) => new Promise((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)) })
const ask = (server, path) => new Promise((resolve, reject) => {
  const outgoing = http.request({ host: '127.0.0.1', port: server.address().port, path, method: 'GET' }, (response) => {
    response.resume()
    response.on('end', () => resolve(response.statusCode))
  })
  outgoing.on('error', reject)
  outgoing.end()
})
const settle = () => new Promise((resolve) => setImmediate(resolve))

describe('which routes are measured', () => {
  test('only a route that declares metrics.isDurationMeasured', () => {
    expect(isRouteDurationMeasured({ metrics: { isDurationMeasured: true } })).toBe(true)
    expect(isRouteDurationMeasured({ metrics: { isDurationMeasured: 'yes' } })).toBe(false)
    expect(isRouteDurationMeasured({})).toBe(false)
    expect(routeDurationMiddlewareOf({ routeOptions: {}, routePath: '/v1/a', method: 'get' })).toBe(empty)
  })

  test('statuses go by class', () => {
    expect([200, 204, 302, 404, 449, 500, 599, 101, 'x'].map(statusClassOf)).toEqual(['2xx', '2xx', '3xx', '4xx', '4xx', '5xx', '5xx', 'other', 'other'])
  })
})

describe('a measured route', () => {
  let server
  let metrics
  let clock
  beforeAll(async () => {
    const app = express()
    const nowInMilliseconds = () => clock
    const route = (path, handler, routeOptions = { metrics: { isDurationMeasured: true } }) => app.get(path,
      routeDurationMiddlewareOf({ routeOptions, routePath: path, method: 'GET', nowInMilliseconds }),
      async (req, res, next) => { clock += 120; await processHttp({ options: { handler }, request: req, response: res, next }) })
    route('/v1/fast', async () => ({ ok: true }))
    route('/v1/missing', async () => { throw { code: 404, message: 'Not found' } })
    route('/v1/unmeasured', async () => ({ ok: true }), {})
    server = await listen(app)
  })
  afterAll(async () => { await new Promise((resolve) => server.close(resolve)) })
  beforeEach(() => { clock = 1000; metrics = recordingMetrics(); globalThis.Servable = { App: { Metrics: metrics } } })
  afterEach(() => { delete globalThis.Servable })

  test('an answer is recorded once, in seconds, by route, method and status class, with the buckets (the healthy path)', async () => {
    expect(await ask(server, '/v1/fast')).toBe(200)
    await settle()
    expect(metrics.recorded).toEqual([{
      name: 'servable_route_duration_seconds',
      value: 0.12,
      attributes: { route: '/v1/fast', method: 'get', status_class: '2xx' },
      options: expect.objectContaining({ bucketBoundaries: [...ROUTE_DURATION_BUCKETS_IN_SECONDS] }),
    }])
  })

  test('an error answer is measured under its own status class', async () => {
    expect(await ask(server, '/v1/missing')).toBe(404)
    await settle()
    expect(metrics.recorded.map(({ attributes }) => attributes.status_class)).toEqual(['4xx'])
  })

  test('a route that does not declare it records nothing', async () => {
    expect(await ask(server, '/v1/unmeasured')).toBe(200)
    await settle()
    expect(metrics.recorded).toEqual([])
  })

  test('without Servable.App.Metrics, or with one that throws, the answer is the same', async () => {
    delete globalThis.Servable
    expect(await ask(server, '/v1/fast')).toBe(200)
    globalThis.Servable = { App: { Metrics: { histogram: () => { throw new Error('broken') } } } }
    expect(await ask(server, '/v1/fast')).toBe(200)
  })
})
