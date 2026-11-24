import { compiledQueryStringDeclarationOf } from './declaration.js'
import { coercedValueOf, readDeclaredValues } from './coercion.js'
import { guessedQueryValuesOf, queryStringOfUrl, rawQueryOf } from './queryString.js'
import { checkedBodyOf, compiledBodyDeclarationOf, parsedBodyOf } from './body.js'
import { engineCounterNamed } from '../../../lib/metrics.js'

// Production proof 3.8 (.docs/technical/production-proof-instrumentation-2026-11-23.md), through Servable.App.Metrics:
//   servable_route_parameter_refusals_total{route, source}       a request refused with a 400 (never the value, never the parameter),
//                                                                source `query` (schema.queryString) or `body` (schema.body)
//   servable_route_parameter_reads_total{mode}                   each parameter read: declared, wildcard_guessed, wildcard_typed,
//                                                                undeclared_text, undeclared_guessed (no route: one add per parameter)
//   servable_route_parameter_undeclared_text_reads_total{route}  an undeclared parameter read as raw text with guessing off: the one
//                                                                silent change of behaviour (a handler comparing with a number gets a string)
const refusalsCounter = engineCounterNamed('servable_route_parameter_refusals_total', {
  description: 'Count of requests refused with a 400 because a query parameter or a body field could not be read as declared, by route and source (query, body).',
})
const readsCounter = engineCounterNamed('servable_route_parameter_reads_total', {
  description: 'Count of query parameters read, by how they were read (declared, wildcard_guessed, wildcard_typed, undeclared_text, undeclared_guessed).',
})
const undeclaredTextReadsCounter = engineCounterNamed('servable_route_parameter_undeclared_text_reads_total', {
  description: 'Count of undeclared query parameters read as raw text with guessing off, by route.',
})

// The parameters a route's handler gets (`params`, and `request.query`), read from the request's query string once,
// before the handler (process/http.js, verbs/function/processFunction.js):
//
// - a parameter the route declares in `schema.queryString` is read as its type (coercion.js), its default applied when
//   the request gives none; a value that cannot be read as the type, or a required one missing, refuses the request
//   with a 400 and a message naming every parameter at fault. Refusing, not falling back to the default: a client that
//   sends `limit=abc` or `isDraft=maybe` has a bug, and a plausible answer built on the default would hide it.
// - a parameter it does not declare is read as its `'*'` entry says, else guessed while the engine option
//   `isQueryValueGuessingEnabled` is on (the behaviour before typed parameters), else kept as the text the client sent.
//
// The declaration is compiled once, when the route is defined; what cannot be read in it is logged then, never at a
// request and never failing the boot.
//
// The same reader checks the route's JSON body against `schema.body` (body.js, owner's Q1720 a), when the route declares
// one, parses a body, and the engine option `areDeclaredRouteBodiesChecked` is on: `readBodyOf` answers the checked
// body, defaults applied, or nothing when the route's body is not declared (the handler then gets it raw, as before).

/**
 * @param {object} props
 * @param {any} props.queryStringDeclaration - the route's `schema.queryString`, or nothing.
 * @param {boolean} props.isQueryValueGuessingEnabled
 * @param {boolean} props.areDeclaredRouteParametersTyped - off: every parameter is read as undeclared.
 * @param {any} [props.bodyDeclaration] - the route's `schema.body`, or nothing.
 * @param {boolean} [props.areDeclaredRouteBodiesChecked] - off: every body is handed raw, as before.
 * @param {boolean} [props.isBodyParsed] - whether the route parses a JSON body (not a get, head or trace route, nor a
 *   function route with files); a `schema.body` on a route that does not is logged and ignored.
 * @param {string} [props.routeName] - `GET /v1/article`, for the boot log.
 * @param {(...message: any[]) => void} [props.reportDeclarationProblem]
 * @returns {{ isDeclared: boolean, isWildcardGuessed: boolean, isBodyDeclared: boolean, readQueryOf: (request: { originalUrl?: string, url?: string }) => Record<string, any>, readBodyOf: (request: { body?: any }) => Record<string, any> | undefined }}
 */
export const createRouteParametersReader = ({
  queryStringDeclaration,
  isQueryValueGuessingEnabled,
  areDeclaredRouteParametersTyped,
  bodyDeclaration,
  areDeclaredRouteBodiesChecked = true,
  isBodyParsed = true,
  routeName = 'a route',
  reportDeclarationProblem = console.error,
}) => {
  const isDeclared = queryStringDeclaration !== undefined && queryStringDeclaration !== null
  const { parameters, everyOtherParameter, problems } = areDeclaredRouteParametersTyped
    ? compiledQueryStringDeclarationOf({ queryStringDeclaration })
    : { parameters: {}, everyOtherParameter: null, problems: [] }
  for (const problem of problems) {
    reportDeclarationProblem('[ENGINE] [route parameters]', `${routeName}: schema.queryString`, problem)
  }

  const readUndeclaredValue = everyOtherParameter
    ? (rawValue) => {
      const read = coercedValueOf({ rawValue, declaration: everyOtherParameter, path: '*' })
      if (read.problem) {
        throw { code: 400, message: `Invalid query string: ${read.problem}` }
      }
      return read.value
    }
    : (isQueryValueGuessingEnabled ? guessedQueryValuesOf : (rawValue) => rawValue)

  const undeclaredReadMode = everyOtherParameter
    ? (everyOtherParameter.type === 'guessed' ? 'wildcard_guessed' : 'wildcard_typed')
    : (isQueryValueGuessingEnabled ? 'undeclared_guessed' : 'undeclared_text')
  const countTheReads = (rawQuery) => {
    for (const name of Object.keys(rawQuery || {})) {
      const mode = Object.prototype.hasOwnProperty.call(parameters, name) ? 'declared' : undeclaredReadMode
      readsCounter.add(1, { mode })
      if (mode === 'undeclared_text') {
        undeclaredTextReadsCounter.add(1, { route: routeName })
      }
    }
  }

  const readQueryOf = (request) => {
    const rawQuery = rawQueryOf(queryStringOfUrl(request?.originalUrl ?? request?.url))
    countTheReads(rawQuery)
    let read
    try {
      read = readDeclaredValues({
        rawValues: rawQuery,
        declarations: parameters,
        readUndeclaredValue,
      })
    } catch (error) {
      refusalsCounter.add(1, { route: routeName, source: 'query' })
      throw error
    }
    const { values, problems: problemsOfTheRequest } = read
    if (problemsOfTheRequest.length) {
      refusalsCounter.add(1, { route: routeName, source: 'query' })
      throw { code: 400, message: `Invalid query string: ${problemsOfTheRequest.join('; ')}` }
    }
    return values
  }

  const hasBodyDeclaration = bodyDeclaration !== undefined && bodyDeclaration !== null
  let isBodyDeclared = false
  /** @type {ReturnType<typeof compiledBodyDeclarationOf>} */
  let compiledBody = { fields: {}, everyOtherField: null, problems: [] }
  if (hasBodyDeclaration && areDeclaredRouteBodiesChecked) {
    if (isBodyParsed) {
      compiledBody = compiledBodyDeclarationOf({ bodyDeclaration })
      isBodyDeclared = true
      for (const problem of compiledBody.problems) {
        reportDeclarationProblem('[ENGINE] [route parameters]', `${routeName}: schema.body`, problem)
      }
    } else {
      reportDeclarationProblem('[ENGINE] [route parameters]', `${routeName}: schema.body`, 'this route parses no JSON body (a get, head or trace route, or a function route with files) and its schema.body is ignored')
    }
  }

  const readBodyOf = (request) => {
    if (!isBodyDeclared) {
      return undefined
    }
    try {
      const { values, problems: problemsOfTheBody } = checkedBodyOf({ body: parsedBodyOf(request?.body), fields: compiledBody.fields, everyOtherField: compiledBody.everyOtherField })
      if (problemsOfTheBody.length) {
        throw { code: 400, message: `Invalid body: ${problemsOfTheBody.join('; ')}` }
      }
      return values
    } catch (error) {
      refusalsCounter.add(1, { route: routeName, source: 'body' })
      throw error
    }
  }

  return { isDeclared, isWildcardGuessed: everyOtherParameter?.type === 'guessed', isBodyDeclared, readQueryOf, readBodyOf }
}

export { recordUndeclaredRoute, undeclaredParameterRoutes, forgetUndeclaredParameterRoutes, doesHandlerSeemToReadParameters, recordDefinedRouteParameters, reportTheRouteParametersSummarySoon } from './bootReport.js'
