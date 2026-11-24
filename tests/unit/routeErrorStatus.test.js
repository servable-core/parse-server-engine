import express from 'express'
import http from 'http'
import processHttp from '../../src/register/route/process/http.js'
import processFunction from '../../src/register/route/verbs/function/processFunction.js'
import { httpStatusOfErrorCode } from '../../src/register/route/process/errorStatus.js'

// The status of the answer to a route that threw (owner's Q1470, 2026-11-24): a Parse error code from 100 to 199 was
// sent as the status, an informational one, so the client never got a final answer and the connection was closed; a
// negative code or one above 599 made Express throw and nothing was sent. Those are answered with a 400, the code in the
// body. Through a real Express app on a loopback port, both route kinds (processHttp and the function verb); no other
// service is needed.

const listen = (app) => new Promise((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)) })
const request = (server) => new Promise((resolve, reject) => {
  const outgoing = http.request({ host: '127.0.0.1', port: server.address().port, path: '/a', method: 'GET' }, (response) => {
    let text = ''
    response.setEncoding('utf8')
    response.on('data', (chunk) => { text += chunk })
    response.on('end', () => resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null }))
  })
  outgoing.setTimeout(3000, () => outgoing.destroy(new Error('no final answer within 3 s')))
  outgoing.on('error', reject)
  outgoing.end()
})

describe('the status of an error answer', () => {
  test.each([
    [101, 400],
    [100, 400],
    [199, 400],
    [-1, 400],
    [600, 400],
    [11000, 400],
    [209, 209],
    [404, 404],
    [449, 449],
    [500, 500],
    ['E_SOMETHING', 500],
    [12.5, 500],
  ])('code %p is answered with %p', (code, status) => {
    expect(httpStatusOfErrorCode(code)).toBe(status)
  })
})

describe.each([
  ['processHttp', processHttp],
  ['the function verb', processFunction],
])('a route that throws, through %s', (_name, processRoute) => {
  let server
  let thrown
  beforeAll(async () => {
    const app = express()
    app.get('/a', async (req, res, next) => {
      // The function verb always resolves the caller; no one is signed in here.
      const servableArguments = async () => ({ userResolver: async () => null })
      await processRoute({ servableArguments, options: { handler: async () => { throw thrown } }, request: req, response: res, next })
    })
    server = await listen(app)
  })
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  test.each([
    ['a Parse code from 100 to 199 (101, object not found)', { code: 101, message: 'Object not found.' }, 400, 101],
    ['Parse\'s other cause (-1)', { code: -1, message: 'other cause' }, 400, -1],
    ['a code above 599 (MongoDB\'s duplicate key, 11000)', { code: 11000, message: 'E11000 duplicate key' }, 400, 11000],
    ['a Parse code in the 200s (209, read by web/main as signed out)', { code: 209, message: 'invalid session token' }, 209, 209],
    ['an HTTP code', { code: 404, message: 'Not found' }, 404, 404],
    ['an Error without a code', new Error('boom'), 500, 500],
  ])('%s: a final answer with its status, the code in the body', async (_case, error, status, code) => {
    thrown = error
    const answer = await request(server)
    expect(answer.status).toBe(status)
    expect(answer.body).toEqual({ error: error.message, code })
  })
})
