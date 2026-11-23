import { compiledQueryStringDeclarationOf } from './declaration.js'
import { coercedValueOf, readDeclaredValues } from './coercion.js'
import { guessedQueryValuesOf, queryStringOfUrl, rawQueryOf } from './queryString.js'

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
 * @returns {{ isDeclared: boolean, readQueryOf: (request: { originalUrl?: string, url?: string }) => Record<string, any> }}
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

  const readQueryOf = (request) => {
    const rawQuery = rawQueryOf(queryStringOfUrl(request?.originalUrl ?? request?.url))
    const { values, problems: problemsOfTheRequest } = readDeclaredValues({
      rawValues: rawQuery,
      declarations: parameters,
      readUndeclaredValue,
    })
    if (problemsOfTheRequest.length) {
      throw { code: 400, message: `Invalid query string: ${problemsOfTheRequest.join('; ')}` }
    }
    return values
  }

  return { isDeclared, readQueryOf }
}

export { recordUndeclaredRoute, undeclaredParameterRoutes, forgetUndeclaredParameterRoutes, doesHandlerSeemToReadParameters } from './bootReport.js'
