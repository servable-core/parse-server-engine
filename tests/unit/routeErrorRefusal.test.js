import express from 'express'
import http from 'http'
import processHttp from '../../src/register/route/process/http.js'
import processFunction from '../../src/register/route/verbs/function/processFunction.js'
import {
  errorAnswerBodyOf,
  refusalCodeOfThrownError,
  sendableRefusalDetailsOfThrownError,
} from '../../src/register/route/process/errorAnswer.js'

// A refusal a route throws reaches the client (owner's Q440 a, 2026-11-27): `refusalCode`, and the plain values of its
// `refusalDetails`, are sent with `{ error, code }`; nothing else of the error ever is, and an error with no refusal is
// answered exactly as before. Through a real Express app on a loopback port, both route kinds (processHttp and the
// function verb); no other service is needed.

const listen = (app) => new Promise((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)) })
const request = (server) => new Promise((resolve, reject) => {
  const outgoing = http.request({ host: '127.0.0.1', port: server.address().port, path: '/a', method: 'GET' }, (response) => {
    let text = ''
    response.setEncoding('utf8')
    response.on('data', (chunk) => { text += chunk })
    response.on('end', () => resolve({ status: response.statusCode, text, body: text ? JSON.parse(text) : null }))
  })
  outgoing.setTimeout(3000, () => outgoing.destroy(new Error('no final answer within 3 s')))
  outgoing.on('error', reject)
  outgoing.end()
})

describe('the refusal code of a thrown error', () => {
  test.each([
    ['a short name', { refusalCode: 'erasureNotReady' }, 'erasureNotReady'],
    ['a name with underscores', { refusalCode: 'publication_not_invitable' }, 'publication_not_invitable'],
    ['a name with a dot or a dash', { refusalCode: 'payout.not-enabled' }, 'payout.not-enabled'],
    ['no refusal code', { code: 404 }, null],
    ['a number', { refusalCode: 409 }, null],
    ['an object', { refusalCode: { name: 'blocked' } }, null],
    ['a sentence', { refusalCode: 'This publication cannot be invited.' }, null],
    ['a name starting with a digit', { refusalCode: '1blocked' }, null],
    ['a name longer than 64 characters', { refusalCode: `a${'b'.repeat(64)}` }, null],
    ['an empty text', { refusalCode: '' }, null],
    ['no error at all', undefined, null],
  ])('%s', (_case, error, refusalCode) => {
    expect(refusalCodeOfThrownError(error)).toBe(refusalCode)
  })
})

describe('the details of a thrown refusal', () => {
  test('keeps text, finite numbers, true/false, null and short lists of them', () => {
    const details = sendableRefusalDetailsOfThrownError({
      refusalDetails: {
        publicationName: 'Le Monde des Livres',
        removalEndsAt: '2026-12-27T00:00:00.000Z',
        blockerCount: 2,
        isRetryable: true,
        walletId: null,
        reasons: ['openDebt', 'payoutInFlight'],
      },
    })
    expect(details).toEqual({
      publicationName: 'Le Monde des Livres',
      removalEndsAt: '2026-12-27T00:00:00.000Z',
      blockerCount: 2,
      isRetryable: true,
      walletId: null,
      reasons: ['openDebt', 'payoutInFlight'],
    })
  })

  test('leaves out, key by key, a nested object, a list holding an object, a long text, a function and a number that is not finite', () => {
    const details = sendableRefusalDetailsOfThrownError({
      refusalDetails: {
        kept: 'yes',
        nested: { internalId: 'abc' },
        listWithAnObject: [{ internalId: 'abc' }],
        longText: 'x'.repeat(1001),
        callback: () => {},
        notFinite: Number.POSITIVE_INFINITY,
        notANumber: Number.NaN,
        undefinedValue: undefined,
        tooLongList: Array.from({ length: 51 }, (_, index) => index),
      },
    })
    expect(details).toEqual({ kept: 'yes' })
  })

  test('keeps at most 30 keys', () => {
    const refusalDetails = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`key${index}`, index]))
    expect(Object.keys(sendableRefusalDetailsOfThrownError({ refusalDetails }))).toHaveLength(30)
  })

  test.each([
    ['no details', {}],
    ['details that are a text', { refusalDetails: 'blocked' }],
    ['details that are a list', { refusalDetails: ['blocked'] }],
    ['details that are an instance of a class', { refusalDetails: new Date() }],
    ['details with nothing that may be sent', { refusalDetails: { nested: {} } }],
  ])('none for %s', (_case, error) => {
    expect(sendableRefusalDetailsOfThrownError(error)).toBeNull()
  })

  test('details without a refusal code are not sent', () => {
    expect(errorAnswerBodyOf({ message: 'No.', code: 409, thrownError: { refusalDetails: { reason: 'x' } } }))
      .toEqual({ error: 'No.', code: 409 })
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

  test('a thrown refusal reaches the answer, with its status and message', async () => {
    thrown = { message: 'Accounts cannot be deleted right now. Try again later.', code: 503, isRetryable: true, refusalCode: 'erasureNotReady' }
    const answer = await request(server)
    expect(answer.status).toBe(503)
    expect(answer.body).toEqual({ error: thrown.message, code: 503, refusalCode: 'erasureNotReady' })
  })

  test('an Error carrying a refusal code reaches the answer the same way', async () => {
    thrown = Object.assign(new Error('This publication cannot be invited.'), { code: 403, refusalCode: 'blocked' })
    const answer = await request(server)
    expect(answer.status).toBe(403)
    expect(answer.body).toEqual({ error: 'This publication cannot be invited.', code: 403, refusalCode: 'blocked' })
  })

  test('its plain details are sent, filtered', async () => {
    thrown = {
      message: 'This account cannot be deleted yet.',
      code: 409,
      refusalCode: 'publicationBeingRemoved',
      refusalDetails: { publicationName: 'Le Monde des Livres', removalEndsAt: '2026-12-27', internal: { mongoId: 'x' } },
    }
    const answer = await request(server)
    expect(answer.status).toBe(409)
    expect(answer.body).toEqual({
      error: 'This account cannot be deleted yet.',
      code: 409,
      refusalCode: 'publicationBeingRemoved',
      refusalDetails: { publicationName: 'Le Monde des Livres', removalEndsAt: '2026-12-27' },
    })
  })

  test('an error with no refusal is answered exactly as before', async () => {
    thrown = { message: 'Not found', code: 404 }
    const answer = await request(server)
    expect(answer.status).toBe(404)
    expect(answer.text).toBe(JSON.stringify({ error: 'Not found', code: 404 }))
  })

  test('nothing else of the error is ever sent: no stack, no internal field, no cause', async () => {
    const error = Object.assign(new Error('Could not resolve target account'), {
      code: 403,
      refusalCode: 'payoutAccountNotTheCallersOwn',
      accountId: 'acct_internal',
      walletBlockers: [{ walletId: 'wal_internal' }],
      query: { owner: 'user_internal' },
      cause: new Error('internal cause'),
    })
    thrown = error
    const answer = await request(server)
    expect(Object.keys(answer.body).sort()).toEqual(['code', 'error', 'refusalCode'])
    expect(answer.text).not.toContain('acct_internal')
    expect(answer.text).not.toContain('wal_internal')
    expect(answer.text).not.toContain('user_internal')
    expect(answer.text).not.toContain('internal cause')
    expect(answer.text).not.toContain('stack')
    expect(answer.text).not.toContain(error.stack.split('\n')[1].trim())
  })

  test('a refusal code that is not a short name is left out', async () => {
    thrown = { message: 'No.', code: 400, refusalCode: { secret: 'value' } }
    const answer = await request(server)
    expect(answer.body).toEqual({ error: 'No.', code: 400 })
  })
})
