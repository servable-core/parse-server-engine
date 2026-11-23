import { jest } from '@jest/globals'
import fc from 'fast-check'
import qs from 'qs'
import { createQueryParser, guessedQueryValuesOf, queryStringOfUrl, rawQueryOf } from '../../src/register/route/parameters/queryString.js'
import { compiledQueryStringDeclarationOf, normalizedDeclarationOf } from '../../src/register/route/parameters/declaration.js'
import { createRouteParametersReader } from '../../src/register/route/parameters/index.js'
import {
  doesHandlerSeemToReadParameters,
  forgetUndeclaredParameterRoutes,
  recordUndeclaredRoute,
  undeclaredParameterRoutes,
  undeclaredParameterRoutesSummary,
} from '../../src/register/route/parameters/bootReport.js'
import { engineOptionsFrom } from '../../src/options/index.js'

// Typed route parameters (owner's Q1230 a and Q1375 a, 2026-11-23): a route that declares a parameter's type in
// `schema.queryString` gets it read as that type, once, before its handler; a route that declares nothing reads its query
// string as before, guessed while `isQueryValueGuessingEnabled` is on.

const readerOf = (queryStringDeclaration, { isQueryValueGuessingEnabled = true, areDeclaredRouteParametersTyped = true } = {}) => {
  const reportDeclarationProblem = jest.fn()
  const reader = createRouteParametersReader({ queryStringDeclaration, isQueryValueGuessingEnabled, areDeclaredRouteParametersTyped, routeName: 'GET /test', reportDeclarationProblem })
  return { ...reader, reportDeclarationProblem, read: (queryString) => reader.readQueryOf({ originalUrl: `/test${queryString ? `?${queryString}` : ''}` }) }
}

const refusalOf = (read) => {
  try {
    read()
  } catch (error) {
    return error
  }
  throw new Error('the request was not refused')
}

describe('the query string', () => {
  test('is read raw as text, with allowDots and qs arrays', () => {
    expect(rawQueryOf('a=1&b=true&c=007&d.e=2&f=1&f=2&g[]=x')).toEqual({ a: '1', b: 'true', c: '007', d: { e: '2' }, f: ['1', '2'], g: ['x'] })
    expect(queryStringOfUrl('/v1/x?a=1&b=2')).toBe('a=1&b=2')
    expect(queryStringOfUrl('/v1/x')).toBe('')
    expect(queryStringOfUrl(undefined)).toBe('')
  })

  test('is guessed exactly as the engine always guessed it', () => {
    expect(guessedQueryValuesOf(rawQueryOf('a=1&b=true&c=007&d=1.50&e=-3&f=FALSE&g=1e3&h=%2B1&i=false&j.k=2&l=1&l=x'))).toEqual({
      a: 1, b: true, c: 7, d: 1.5, e: -3, f: 'FALSE', g: '1e3', h: '+1', i: false, j: { k: 2 }, l: [1, 'x'],
    })
  })

  test('is guessed as the parser before typed parameters guessed it, for any query string', () => {
    // The parser createapp/index.js had until typed parameters, copied as it was.
    const numberRegex = /^-?\d+(\.\d+)?$/
    const formerParser = (str) => qs.parse(str, {
      allowDots: true,
      decoder: (str, defaultDecoder, charset) => {
        const val = defaultDecoder(str, defaultDecoder, charset)
        if (typeof val === 'string' && numberRegex.test(val)) {
          const num = Number(val)
          if (!Number.isNaN(num)) {
            return num
          }
        }
        if (typeof val === 'string' && (val === 'false')) {
          return false
        }
        if (typeof val === 'string' && (val === 'true')) {
          return true
        }
        return val
      },
    })
    const parser = createQueryParser({ isQueryValueGuessingEnabled: true })
    const name = fc.constantFrom('a', 'b', 'page', 'filter.status', 'ids[]', 'list[0]', 'list[1]', 'x.y.z')
    const value = fc.oneof(fc.constantFrom('1', '007', '-3', '1.50', 'true', 'false', 'TRUE', '', '1e3', '%2B1', 'abc', '0x10', 'a%20b'), fc.string({ maxLength: 6 }).map(encodeURIComponent))
    const queryString = fc.array(fc.tuple(name, value), { maxLength: 8 }).map((pairs) => pairs.map(([key, text]) => `${key}=${text}`).join('&'))
    fc.assert(fc.property(queryString, (generated) => {
      expect(parser(generated)).toEqual(formerParser(generated))
    }), { numRuns: 2000, seed: 1230 })
  })

  test('is what Express hands request.query: guessed when the option is on, text when it is off', () => {
    expect(createQueryParser({ isQueryValueGuessingEnabled: true })('a=123&b=true')).toEqual({ a: 123, b: true })
    expect(createQueryParser({ isQueryValueGuessingEnabled: false })('a=123&b=true')).toEqual({ a: '123', b: 'true' })
  })
})

describe('a declared boolean', () => {
  const { read } = readerOf({ isDraft: 'boolean' })

  test('reads true, 1, yes, on and false, 0, no, off, in any case', () => {
    for (const word of ['true', 'TRUE', 'True', '1', 'yes', 'YES', 'on', 'On', '%20true%20']) {
      expect(read(`isDraft=${word}`).isDraft).toBe(true)
    }
    for (const word of ['false', 'FALSE', '0', 'no', 'No', 'off', 'OFF']) {
      expect(read(`isDraft=${word}`).isDraft).toBe(false)
    }
  })

  test('refuses anything else with a 400 naming the parameter', () => {
    const refusal = refusalOf(() => read('isDraft=maybe'))
    expect(refusal.code).toBe(400)
    expect(refusal.message).toContain('"isDraft"')
    expect(refusal.message).toContain('"maybe"')
    expect(refusalOf(() => read('isDraft=1&isDraft=0')).code).toBe(400)
  })

  test('is absent when not given and has no default, and an empty value is no value', () => {
    expect(read('')).toEqual({})
    expect(read('isDraft=')).toEqual({})
    expect(read('isDraft')).toEqual({})
  })
})

describe('declared numbers', () => {
  const { read } = readerOf({ page: 'integer', ratio: 'number', limit: { type: 'integer', default: 10, minimum: 1, maximum: 100 } })

  test('read integers and numbers strictly', () => {
    expect(read('page=007&ratio=-1.5')).toEqual({ page: 7, ratio: -1.5, limit: 10 })
    expect(read('page=%2B3&ratio=.5')).toEqual({ page: 3, ratio: 0.5, limit: 10 })
    expect(read('ratio=2e3').ratio).toBe(2000)
    expect(read('limit=100').limit).toBe(100)
  })

  test('refuse text that is not one, and values outside the limits', () => {
    for (const queryString of ['page=1.5', 'page=abc', 'page=0x10', 'page=99999999999999999999', 'ratio=Infinity', 'ratio=NaN', 'ratio=1,5', 'limit=0', 'limit=101', 'page[]=1']) {
      expect(refusalOf(() => read(queryString)).code).toBe(400)
    }
  })

  test('name every parameter at fault in one refusal', () => {
    const refusal = refusalOf(() => read('page=x&ratio=y'))
    expect(refusal.message).toContain('"page"')
    expect(refusal.message).toContain('"ratio"')
  })
})

describe('a declared string', () => {
  const { read } = readerOf({ slug: 'string', name: { type: 'string', maxLength: 5 }, sort: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } })

  test('stays the text it was sent as, number-looking or not', () => {
    expect(read('slug=123&name=true')).toEqual({ slug: '123', name: 'true', sort: 'desc' })
    expect(read('slug=007').slug).toBe('007')
    expect(read('slug=').slug).toBe('')
  })

  test('is checked against its length and its enum', () => {
    expect(read('sort=asc').sort).toBe('asc')
    expect(refusalOf(() => read('sort=up')).message).toContain('one of "asc", "desc"')
    expect(refusalOf(() => read('name=toolong')).code).toBe(400)
    expect(refusalOf(() => read('slug=a&slug=b')).code).toBe(400)
  })
})

describe('a declared array', () => {
  const { read } = readerOf({ ids: 'string[]', counts: { type: 'array', items: 'integer', maxItems: 3 }, visibilities: { type: 'array', default: ['published'] } })

  test('reads every value given under its name, one value making a list of one', () => {
    expect(read('ids=1&ids=2')).toEqual({ ids: ['1', '2'], visibilities: ['published'] })
    expect(read('ids[]=7').ids).toEqual(['7'])
    expect(read('ids=7').ids).toEqual(['7'])
    expect(read('counts[0]=1&counts[1]=2').counts).toEqual([1, 2])
    expect(read('visibilities=draft').visibilities).toEqual(['draft'])
  })

  test('refuses an item that is not of its type, and too many items', () => {
    expect(refusalOf(() => read('counts=1&counts=x')).message).toContain('"counts[1]"')
    expect(refusalOf(() => read('counts=1&counts=2&counts=3&counts=4')).code).toBe(400)
  })

  test('hands each request its own copy of the default', () => {
    const first = read('')
    first.visibilities.push('mutated')
    expect(read('').visibilities).toEqual(['published'])
  })
})

describe('a declared object', () => {
  const { read } = readerOf({ filter: { type: 'object', properties: { isPinned: 'boolean', status: { type: 'string', default: 'live' } } } })

  test('reads its declared properties as declared and keeps the others as text', () => {
    expect(read('filter.isPinned=yes&filter.other=12')).toEqual({ filter: { isPinned: true, status: 'live', other: '12' } })
  })

  test('refuses a property that cannot be read', () => {
    expect(refusalOf(() => read('filter.isPinned=perhaps')).message).toContain('"filter.isPinned"')
    expect(refusalOf(() => read('filter=flat')).code).toBe(400)
  })
})

describe('required parameters and defaults', () => {
  test('a required parameter missing is refused, a default is applied', () => {
    const { read } = readerOf({ id: { type: 'string', isRequired: true }, isLive: { type: 'boolean', default: false } })
    expect(refusalOf(() => read('')).message).toContain('"id" is required')
    expect(read('id=a')).toEqual({ id: 'a', isLive: false })
  })
})

describe('undeclared parameters', () => {
  test('are guessed while the option is on, beside the declared ones', () => {
    const { read } = readerOf({ slug: 'string' })
    expect(read('slug=123&page=2&isOpen=true')).toEqual({ slug: '123', page: 2, isOpen: true })
  })

  test('are the text the client sent when the option is off', () => {
    const { read } = readerOf({ slug: 'string' }, { isQueryValueGuessingEnabled: false })
    expect(read('slug=123&page=2&isOpen=true')).toEqual({ slug: '123', page: '2', isOpen: 'true' })
  })

  test('of a route that declares nothing are read exactly as before', () => {
    expect(readerOf(undefined).read('a=1&b=true&c=x')).toEqual({ a: 1, b: true, c: 'x' })
    expect(readerOf(undefined, { isQueryValueGuessingEnabled: false }).read('a=1&b=true')).toEqual({ a: '1', b: 'true' })
    expect(readerOf(undefined).isDeclared).toBe(false)
    expect(readerOf({}).isDeclared).toBe(true)
  })

  test('follow the route\'s "*" entry whatever the option says', () => {
    const guessed = readerOf({ slug: 'string', '*': 'guessed' }, { isQueryValueGuessingEnabled: false })
    expect(guessed.read('slug=1&page=2&isOpen=true')).toEqual({ slug: '1', page: 2, isOpen: true })
    const asSent = readerOf({ '*': 'any' })
    expect(asSent.read('page=2&filter.a=1')).toEqual({ page: '2', filter: { a: '1' } })
    const asText = readerOf({ '*': 'string' })
    expect(refusalOf(() => asText.read('a=1&a=2')).code).toBe(400)
  })

  test('declared as any or guessed one by one', () => {
    const { read } = readerOf({ payload: 'any', legacy: 'guessed' }, { isQueryValueGuessingEnabled: false })
    expect(read('payload.x=1&legacy=12')).toEqual({ payload: { x: '1' }, legacy: 12 })
  })
})

describe('the switch for declared types', () => {
  test('reads every parameter as undeclared when off', () => {
    const { read } = readerOf({ slug: 'string', isDraft: { type: 'boolean', default: false } }, { areDeclaredRouteParametersTyped: false })
    expect(read('slug=123&isDraft=maybe')).toEqual({ slug: 123, isDraft: 'maybe' })
  })
})

describe('a declaration the engine cannot read', () => {
  test('is reported when the route is defined, and never throws', () => {
    const { reportDeclarationProblem, read } = readerOf({
      pageSize: { type: 'number', defaultValue: 10 },
      kind: { type: 'text' },
      sort: { type: 'string', enum: [1, 2] },
      limit: { type: 'integer', default: 'ten' },
    })
    const reported = reportDeclarationProblem.mock.calls.map((call) => call.join(' ')).join('\n')
    expect(reported).toContain('"pageSize": "defaultValue" is not a word of a number declaration and is ignored; did you mean "default"?')
    expect(reported).toContain('"kind": unknown type "text"')
    expect(reported).toContain('"sort": "enum" holds values that are not of type string')
    expect(reported).toContain('"limit": the default "ten" breaks its own declaration')
    // pageSize is still a number; kind is undeclared, so guessed; the broken default and enum are dropped.
    expect(read('pageSize=3&kind=7&sort=z')).toEqual({ pageSize: 3, kind: 7, sort: 'z' })
  })

  test('as a whole is ignored when it is not an object', () => {
    expect(compiledQueryStringDeclarationOf({ queryStringDeclaration: ['a'] }).problems).toHaveLength(1)
    expect(normalizedDeclarationOf({ declaration: 'boolean[]', path: 'x' }).declaration).toEqual({ type: 'array', items: { type: 'boolean' } })
  })
})

describe('the boot report', () => {
  afterEach(() => forgetUndeclaredParameterRoutes())

  test('lists the routes that declare nothing, and which of them seem to read their parameters', () => {
    recordUndeclaredRoute({ routeName: 'GET /a', handler: async ({ params }) => params.id })
    recordUndeclaredRoute({ routeName: 'GET /b', handler: async ({ request }) => request.query.id })
    recordUndeclaredRoute({ routeName: 'POST /c', handler: async ({ user }) => user })
    expect(undeclaredParameterRoutes()).toEqual([
      { routeName: 'GET /a', doesSeemToReadParameters: true },
      { routeName: 'GET /b', doesSeemToReadParameters: true },
      { routeName: 'POST /c', doesSeemToReadParameters: false },
    ])
    expect(undeclaredParameterRoutesSummary()).toBe('[ENGINE] [route parameters] 3 route(s) declare no schema.queryString, 2 of them seeming to read their parameters: GET /a; GET /b')
    expect(doesHandlerSeemToReadParameters(undefined)).toBe(false)
  })

  test('is empty when every route declares', () => {
    expect(undeclaredParameterRoutesSummary()).toBeNull()
  })
})

describe('the engine options of route parameters', () => {
  test('default to guessing on, declared types on, refusal off; each overridden by its variable', () => {
    expect(engineOptionsFrom({ env: {} })).toMatchObject({ isQueryValueGuessingEnabled: true, areDeclaredRouteParametersTyped: true, areUndeclaredParameterRoutesRefused: false })
    expect(engineOptionsFrom({ engineConfiguration: { isQueryValueGuessingEnabled: false }, env: {} }).isQueryValueGuessingEnabled).toBe(false)
    expect(engineOptionsFrom({
      engineConfiguration: { isQueryValueGuessingEnabled: false },
      env: { SERVABLE_QUERY_VALUE_GUESSING: 'on', SERVABLE_TYPED_ROUTE_PARAMETERS: 'off', SERVABLE_REFUSE_UNDECLARED_PARAMETER_ROUTES: '1' },
    })).toMatchObject({ isQueryValueGuessingEnabled: true, areDeclaredRouteParametersTyped: false, areUndeclaredParameterRoutesRefused: true })
  })
})
