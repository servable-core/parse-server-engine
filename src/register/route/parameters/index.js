import { compiledQueryStringDeclarationOf } from './declaration.js'
import { coercedValueOf, readDeclaredValues } from './coercion.js'
import { guessedQueryValuesOf, queryStringOfUrl, rawQueryOf } from './queryString.js'
import { engineCounterNamed } from '../../../lib/metrics.js'

// Production proof 3.8 (.docs/technical/production-proof-instrumentation-2026-11-23.md), through Servable.App.Metrics:
//   servable_route_parameter_refusals_total{route}               a request refused with a 400 (never the value, never the parameter)
//   servable_route_parameter_reads_total{mode}                   each parameter read: declared, wildcard_guessed, wildcard_typed,
//                                                                undeclared_text, undeclared_guessed (no route: one add per parameter)
//   servable_route_parameter_undeclared_text_reads_total{route}  an undeclared parameter read as raw text with guessing off: the one
//                                                                silent change of behaviour (a handler comparing with a number gets a string)
const refusalsCounter = engineCounterNamed('servable_route_parameter_refusals_total', {
  description: 'Count of requests refused with a 400 because a query parameter could not be read as declared, by route.',
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

/**
 * @param {object} props
 * @param {any} props.queryStringDeclaration - the route's `schema.queryString`, or nothing.
 * @param {boolean} props.isQueryValueGuessingEnabled
 * @param {boolean} props.areDeclaredRouteParametersTyped - off: every parameter is read as undeclared.
 * @param {string} [props.routeName] - `GET /v1/article`, for the boot log.
 * @param {(...message: any[]) => void} [props.reportDeclarationProblem]
 * @returns {{ isDeclared: boolean, isWildcardGuessed: boolean, readQueryOf: (request: { originalUrl?: string, url?: string }) => Record<string, any> }}
 */
export const createRouteParametersReader = ({
  queryStringDeclaration,
  isQueryValueGuessingEnabled,
  areDeclaredRouteParametersTyped,
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
      refusalsCounter.add(1, { route: routeName })
      throw error
    }
    const { values, problems: problemsOfTheRequest } = read
    if (problemsOfTheRequest.length) {
      refusalsCounter.add(1, { route: routeName })
      throw { code: 400, message: `Invalid query string: ${problemsOfTheRequest.join('; ')}` }
    }
    return values
  }

  return { isDeclared, isWildcardGuessed: everyOtherParameter?.type === 'guessed', readQueryOf }
}

export { recordUndeclaredRoute, undeclaredParameterRoutes, forgetUndeclaredParameterRoutes, doesHandlerSeemToReadParameters, recordDefinedRouteParameters, reportTheRouteParametersSummarySoon } from './bootReport.js'
