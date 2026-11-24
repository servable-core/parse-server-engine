import express from 'express'
import http from 'http'
import processHttp from '../../src/register/route/process/http.js'
import processFunction from '../../src/register/route/verbs/function/processFunction.js'
import { remappedKindOfErrorCode } from '../../src/register/route/process/errorStatus.js'

// Production proof of the error status remap (owner's Q1580 a, 2026-11-24): each error answer whose status is not the thrown
// code is counted by the kind of code (parse_1xx, negative, mongo, not_integer), never the code, through Servable.App.Metrics.
// An HTTP code kept as the status (the healthy path) counts nothing.

const recordingMetrics = () => {
  const recorded = []
  return { recorded, counter: (name) => ({ add: (value, attributes) => recorded.push({ name, value, ...attributes }) }) }
}

const listen = (app) => new Promise((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)) })
const ask = (server) => new Promise((resolve, reject) => {
  const outgoing = http.request({ host: '127.0.0.1', port: server.address().port, path: '/a', method: 'GET' }, (response) => {
    response.resume()
    response.on('end', () => resolve(response.statusCode))
  })
  outgoing.setTimeout(3000, () => outgoing.destroy(new Error('no final answer within 3 s')))
  outgoing.on('error', reject)
  outgoing.end()
})

describe('remappedKindOfErrorCode', () => {
  test.each([
    [101, 'parse_1xx'],
    [1, 'parse_1xx'],
    [199, 'parse_1xx'],
    [-1, 'negative'],
    [600, 'mongo'],
    [11000, 'mongo'],
    ['E_SOMETHING', 'not_integer'],
    [12.5, 'not_integer'],
    [200, null],
    [209, null],
    [404, null],
    [500, null],
    [599, null],
  ])('code %p is %p', (code, kind) => {
    expect(remappedKindOfErrorCode(code)).toBe(kind)
  })
})

describe.each([
  ['processHttp', processHttp],
  ['the function verb', processFunction],
])('a route that throws, through %s', (_name, processRoute) => {
  let server
  let thrown
  let metrics
  beforeAll(async () => {
    const app = express()
    app.get('/a', async (req, res, next) => {
      const servableArguments = async () => ({ userResolver: async () => null })
      await processRoute({ servableArguments, options: { handler: async () => { throw thrown } }, request: req, response: res, next })
    })
    server = await listen(app)
  })
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
  })
  beforeEach(() => { metrics = recordingMetrics(); globalThis.Servable = { App: { Metrics: metrics } } })
  afterEach(() => { delete globalThis.Servable })

  test('an HTTP code kept as the status counts nothing (the healthy path)', async () => {
    thrown = { code: 404, message: 'Not found' }
    expect(await ask(server)).toBe(404)
    thrown = new Error('boom')
    expect(await ask(server)).toBe(500)
    expect(metrics.recorded).toEqual([])
  })

  test.each([
    [{ code: 101, message: 'Object not found.' }, 400, 'parse_1xx'],
    [{ code: -1, message: 'other cause' }, 400, 'negative'],
    [{ code: 11000, message: 'E11000 duplicate key' }, 400, 'mongo'],
    [{ code: 'ECONNRESET', message: 'socket hang up' }, 500, 'not_integer'],
  ])('%p is answered %p and counted as %p (the remap path)', async (error, status, fromKind) => {
    thrown = error
    expect(await ask(server)).toBe(status)
    expect(metrics.recorded).toEqual([{ name: 'servable_route_error_status_remapped_total', value: 1, from_kind: fromKind }])
  })

  test('without Servable.App.Metrics the answer is the same and nothing throws', async () => {
    delete globalThis.Servable
    thrown = { code: 101, message: 'Object not found.' }
    expect(await ask(server)).toBe(400)
  })
})
