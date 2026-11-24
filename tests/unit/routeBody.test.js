import { jest } from '@jest/globals'
import { compiledBodyDeclarationOf, checkedBodyOf } from '../../src/register/route/parameters/body.js'
import { createRouteParametersReader } from '../../src/register/route/parameters/index.js'
import { ENGINE_OPTIONS, engineOptionsFrom } from '../../src/options/index.js'

// Declared bodies (owner's Q1720 a, 2026-11-24, docs/typed-route-parameters.md "Declared bodies"): a route that declares
// `schema.body` gets its JSON body checked against it before its handler, with the vocabulary of `schema.queryString`;
// values are checked, never converted, and a body that breaks its declaration is refused with a 400 that never quotes a
// value. A route that declares no body gets it raw, as before.

const recordingMetrics = () => {
  const recorded = []
  return { recorded, counter: (name) => ({ add: (value, attributes) => recorded.push({ name, value, ...attributes }) }) }
}
let metrics
beforeEach(() => { metrics = recordingMetrics(); globalThis.Servable = { App: { Metrics: metrics } } })
afterEach(() => { delete globalThis.Servable })
const refusalsCounted = () => metrics.recorded.filter((point) => point.name === 'servable_route_parameter_refusals_total')

const readerOf = (bodyDeclaration, { areDeclaredRouteBodiesChecked = true, isBodyParsed = true, queryStringDeclaration } = {}) => {
  const reportDeclarationProblem = jest.fn()
  const reader = createRouteParametersReader({
    queryStringDeclaration,
    bodyDeclaration,
    isQueryValueGuessingEnabled: false,
    areDeclaredRouteParametersTyped: true,
    areDeclaredRouteBodiesChecked,
    isBodyParsed,
    routeName: 'POST /v1/account/signin/with',
    reportDeclarationProblem,
  })
  const readBody = (body) => reader.readBodyOf({ body: body === undefined ? undefined : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) })
  return { ...reader, reportDeclarationProblem, readBody }
}

const refusalOf = (read) => {
  try {
    read()
  } catch (error) {
    return error
  }
  throw new Error('the body was not refused')
}

describe('a declared body, compiled', () => {
  test('reads the shorthands and full declarations of schema.queryString', () => {
    const { fields, everyOtherField, problems } = compiledBodyDeclarationOf({ bodyDeclaration: { id: 'string', ids: 'integer[]', locale: { type: 'string', maxLength: 35 } } })
    expect(problems).toEqual([])
    expect(fields).toEqual({
      id: { type: 'string' },
      ids: { type: 'array', items: { type: 'integer' } },
      locale: { type: 'string', maxLength: 35 },
    })
    expect(everyOtherField).toBeNull()
  })

  test('reads "guessed" as "any", and says so: a JSON body carries its types', () => {
    const { fields, problems } = compiledBodyDeclarationOf({ bodyDeclaration: { legacy: 'guessed', nested: { type: 'object', properties: { inner: 'guessed' } } } })
    expect(fields.legacy).toEqual({ type: 'any' })
    expect(fields.nested.properties.inner).toEqual({ type: 'any' })
    expect(problems).toHaveLength(2)
    expect(problems[0]).toContain('"legacy": "guessed" means nothing in a JSON body')
  })

  test('holds any JSON value in an array without items (text in a query string)', () => {
    expect(compiledBodyDeclarationOf({ bodyDeclaration: { tags: 'array' } }).fields.tags).toEqual({ type: 'array', items: { type: 'any' } })
  })

  test('logs what it cannot read and never throws', () => {
    const { problems } = compiledBodyDeclarationOf({ bodyDeclaration: { a: { type: 'text' }, b: { type: 'string', defaultValue: 'x' } } })
    expect(problems.join('\n')).toContain('"a": unknown type "text"')
    expect(problems.join('\n')).toContain('did you mean "default"?')
    expect(compiledBodyDeclarationOf({ bodyDeclaration: ['a'] }).problems).toEqual(['"schema.body" must be an object of declarations, one per field, and is ignored'])
  })

  test('reads the "*" entry as the declaration of every field the route does not name, never with a default', () => {
    const { everyOtherField, problems } = compiledBodyDeclarationOf({ bodyDeclaration: { '*': { type: 'string', maxLength: 5, default: 'x' } } })
    expect(everyOtherField).toEqual({ type: 'string', maxLength: 5 })
    expect(problems).toHaveLength(1)
  })
})

describe('a declared body, checked', () => {
  const declaration = compiledBodyDeclarationOf({
    bodyDeclaration: {
      provider: { type: 'string', maxLength: 20 },
      count: 'integer',
      ratio: 'number',
      rememberMe: { type: 'boolean', default: false },
      tags: { type: 'array', items: { type: 'string', maxLength: 3 }, maxItems: 2 },
      installation: { type: 'object', properties: { deviceType: { type: 'string', maxLength: 10 } } },
      sort: { type: 'string', enum: ['asc', 'desc'] },
      payload: 'any',
    },
  })
  const check = (body) => checkedBodyOf({ body, ...declaration })

  test('accepts values of their declared type, as sent, and keeps undeclared fields as sent', () => {
    const body = { provider: 'google', count: 3, ratio: 1.5, rememberMe: true, tags: ['a', 'b'], installation: { deviceType: 'web', other: 1 }, sort: 'asc', payload: { x: [1] }, extra: 'kept' }
    expect(check(body)).toEqual({ values: body, problems: [] })
  })

  test.each([
    ['boolean', { rememberMe: 'true' }, '"rememberMe": expected true or false, got text of 4 characters'],
    ['boolean', { rememberMe: 1 }, '"rememberMe": expected true or false, got a number'],
    ['integer', { count: 1.5 }, '"count": expected an integer, got a number'],
    ['integer', { count: '7' }, '"count": expected an integer, got text of 1 character'],
    ['number', { ratio: '1.5' }, '"ratio": expected a number, got text of 3 characters'],
    ['string', { provider: 12 }, '"provider": expected text, got a number'],
    ['string', { provider: ['google'] }, '"provider": expected text, got a list of 1'],
    ['array', { tags: 'a' }, '"tags": expected a list, got text of 1 character'],
    ['object', { installation: [] }, '"installation": expected an object, got a list of 0'],
  ])('refuses a %s it would have to convert: %j', (_, body, problem) => {
    expect(check(body).problems).toEqual([problem])
  })

  test('refuses a value beyond its limits, naming the field, never quoting the value', () => {
    const secret = 'google-but-far-too-long-for-a-provider'
    const { problems } = check({ provider: secret, tags: ['a', 'b', 'c'], sort: 'up' })
    expect(problems).toEqual([
      `"provider": expected at most 20 characters, got text of ${secret.length} characters`,
      '"tags": expected at most 2 values, got a list of 3',
      '"sort": expected one of "asc", "desc", got text of 2 characters',
    ])
    expect(problems.join()).not.toContain(secret)
  })

  test('checks list items and nested properties, the path naming the one at fault', () => {
    expect(check({ tags: ['ok', 'long'] }).problems).toEqual(['"tags[1]": expected at most 3 characters, got text of 4 characters'])
    expect(check({ installation: { deviceType: 'a-very-long-device' } }).problems).toEqual(['"installation.deviceType": expected at most 10 characters, got text of 18 characters'])
  })

  test('reads null and a missing field as no value: the default applies, else the field stays as sent', () => {
    expect(check({}).values).toEqual({ rememberMe: false })
    expect(check({ rememberMe: null }).values).toEqual({ rememberMe: false })
    expect(check({ provider: null }).values).toEqual({ provider: null, rememberMe: false })
    expect(check({ provider: null }).problems).toEqual([])
  })

  test('refuses a required field missing or null', () => {
    const required = compiledBodyDeclarationOf({ bodyDeclaration: { idToken: { type: 'string', isRequired: true }, nested: { type: 'object', properties: { id: { type: 'string', isRequired: true } } } } })
    expect(checkedBodyOf({ body: { idToken: null }, ...required }).problems).toEqual(['"idToken" is required'])
    expect(checkedBodyOf({ body: { idToken: 'x', nested: {} }, ...required }).problems).toEqual(['"nested.id" is required'])
  })

  test('copies a default, so a handler changing it never changes the next request\'s', () => {
    const withList = compiledBodyDeclarationOf({ bodyDeclaration: { tags: { type: 'array', default: ['a'] } } })
    const first = checkedBodyOf({ body: {}, ...withList }).values
    first.tags.push('b')
    expect(checkedBodyOf({ body: {}, ...withList }).values.tags).toEqual(['a'])
  })

  test('checks every field the route does not name against "*"', () => {
    const everyOther = compiledBodyDeclarationOf({ bodyDeclaration: { id: 'integer', '*': { type: 'string', maxLength: 3 } } })
    expect(checkedBodyOf({ body: { id: 1, a: 'abc' }, ...everyOther })).toEqual({ values: { id: 1, a: 'abc' }, problems: [] })
    expect(checkedBodyOf({ body: { id: 1, a: 'abcd', b: 2 }, ...everyOther }).problems).toEqual([
      '"a": expected at most 3 characters, got text of 4 characters',
      '"b": expected text, got a number',
    ])
  })
})

describe('the route\'s body reader', () => {
  const signInWithBody = {
    provider: { type: 'string', maxLength: 20 },
    locale: { type: 'string', maxLength: 35 },
    rememberMe: { type: 'boolean', default: false },
  }

  test('hands the checked body, defaults applied, parsed once from the raw buffer', () => {
    const { readBody, isBodyDeclared } = readerOf(signInWithBody)
    expect(isBodyDeclared).toBe(true)
    expect(readBody({ provider: 'google', locale: 'fr-fr' })).toEqual({ provider: 'google', locale: 'fr-fr', rememberMe: false })
  })

  test('reads an empty body, or one bodyParser.raw did not read, as {}', () => {
    const { readBody, readBodyOf } = readerOf(signInWithBody)
    expect(readBody('')).toEqual({ rememberMe: false })
    expect(readBody(undefined)).toEqual({ rememberMe: false })
    expect(readBodyOf({ body: {} })).toEqual({ rememberMe: false })
  })

  test('refuses a body that is not JSON, or not a JSON object, with a 400', () => {
    const { readBody } = readerOf(signInWithBody)
    expect(refusalOf(() => readBody('{"provider":'))).toEqual({ code: 400, message: 'Invalid body: not JSON' })
    expect(refusalOf(() => readBody([1, 2]))).toEqual({ code: 400, message: 'Invalid body: expected a JSON object, got a list of 2' })
    expect(refusalOf(() => readBody('"text"'))).toEqual({ code: 400, message: 'Invalid body: expected a JSON object, got text of 4 characters' })
  })

  test('refuses a body that breaks its declaration with a 400 naming every field at fault, never the value', () => {
    const longLocale = 'x'.repeat(120)
    const refusal = refusalOf(() => readerOf(signInWithBody).readBody({ provider: 7, locale: longLocale }))
    expect(refusal.code).toBe(400)
    expect(refusal.message).toBe('Invalid body: "provider": expected text, got a number; "locale": expected at most 35 characters, got text of 120 characters')
    expect(refusal.message).not.toContain(longLocale)
  })

  test('counts a refused body by route with source="body", never with a value', () => {
    expect(() => readerOf(signInWithBody).readBody({ locale: 'secret-'.repeat(10) })).toThrow()
    expect(() => readerOf(signInWithBody).readBody('not json')).toThrow()
    expect(refusalsCounted()).toEqual([
      { name: 'servable_route_parameter_refusals_total', value: 1, route: 'POST /v1/account/signin/with', source: 'body' },
      { name: 'servable_route_parameter_refusals_total', value: 1, route: 'POST /v1/account/signin/with', source: 'body' },
    ])
    expect(JSON.stringify(metrics.recorded)).not.toContain('secret-')
  })

  test('counts a refused query string with source="query"', () => {
    const reader = readerOf(undefined, { queryStringDeclaration: { page: 'integer' } })
    expect(() => reader.readQueryOf({ url: '/v1/x?page=abc' })).toThrow()
    expect(refusalsCounted()).toEqual([{ name: 'servable_route_parameter_refusals_total', value: 1, route: 'POST /v1/account/signin/with', source: 'query' }])
  })

  test('answers nothing for a route that declares no body: the handler gets it raw, as before', () => {
    const { readBody, isBodyDeclared } = readerOf(undefined)
    expect(isBodyDeclared).toBe(false)
    expect(readBody({ anything: 'x'.repeat(10000) })).toBeUndefined()
  })

  test('answers nothing when the option is off (the kill switch), and reports no declaration problem', () => {
    const { readBody, isBodyDeclared, reportDeclarationProblem } = readerOf({ a: { type: 'text' } }, { areDeclaredRouteBodiesChecked: false })
    expect(isBodyDeclared).toBe(false)
    expect(readBody({ a: 1 })).toBeUndefined()
    expect(reportDeclarationProblem).not.toHaveBeenCalled()
  })

  test('ignores, and logs at define, the body declaration of a route that parses no body', () => {
    const { readBody, isBodyDeclared, reportDeclarationProblem } = readerOf(signInWithBody, { isBodyParsed: false })
    expect(isBodyDeclared).toBe(false)
    expect(readBody({ provider: 7 })).toBeUndefined()
    expect(reportDeclarationProblem).toHaveBeenCalledWith('[ENGINE] [route parameters]', 'POST /v1/account/signin/with: schema.body', 'this route parses no JSON body (a get, head or trace route, or a function route with files) and its schema.body is ignored')
  })

  test('logs the problems of the body declaration at define, as schema.body', () => {
    const { reportDeclarationProblem } = readerOf({ legacy: 'guessed' })
    expect(reportDeclarationProblem).toHaveBeenCalledWith('[ENGINE] [route parameters]', 'POST /v1/account/signin/with: schema.body', expect.stringContaining('"legacy"'))
  })
})

describe('the option', () => {
  test('is on by default and overridden by SERVABLE_CHECKED_ROUTE_BODIES', () => {
    expect(ENGINE_OPTIONS.areDeclaredRouteBodiesChecked).toEqual({ environmentVariable: 'SERVABLE_CHECKED_ROUTE_BODIES', defaultValue: true })
    expect(engineOptionsFrom({ env: {} }).areDeclaredRouteBodiesChecked).toBe(true)
    expect(engineOptionsFrom({ env: {}, engineConfiguration: { areDeclaredRouteBodiesChecked: false } }).areDeclaredRouteBodiesChecked).toBe(false)
    expect(engineOptionsFrom({ env: { SERVABLE_CHECKED_ROUTE_BODIES: 'on' }, engineConfiguration: { areDeclaredRouteBodiesChecked: false } }).areDeclaredRouteBodiesChecked).toBe(true)
    expect(engineOptionsFrom({ env: { SERVABLE_CHECKED_ROUTE_BODIES: 'off' } }).areDeclaredRouteBodiesChecked).toBe(false)
  })
})
