import qs from 'qs'

// How the engine reads a query string. Every value of a query string is text; the engine reads it twice over:
//
// - as text (`rawQueryOf`), the shape qs gives with `allowDots` (`a.b=1` is `{ a: { b: '1' } }`, `a=1&a=2` and `a[]=1`
//   are arrays), every value a string. A route that declares a parameter's type reads it from here
//   (parameters/index.js), so `123` stays the text `123` when the route declared a string.
// - guessed (`guessedQueryValuesOf`), the engine's behaviour since its first release: a value that looks like a number
//   (`-?\d+(\.\d+)?`) becomes that number, the exact words `true` and `false` booleans, the rest stays text. It applies to
//   the parameters no route declared, and to `request.query` everywhere outside a route's handler, while the engine
//   option `isQueryValueGuessingEnabled` is on (options/index.js; on by default until the next major).

// The options Express's query parser always used here (createapp/index.js); kept so `a.b=1` reads the same both ways.
const QUERY_STRING_PARSE_OPTIONS = { allowDots: true }

const NUMBER_LOOKING_TEXT = /^-?\d+(\.\d+)?$/

/**
 * The query string of a request's url: what follows the first `?`, or nothing.
 * @param {string | undefined | null} url
 * @returns {string}
 */
export const queryStringOfUrl = (url) => {
  if (typeof url !== 'string') {
    return ''
  }
  const questionMarkIndex = url.indexOf('?')
  return questionMarkIndex === -1 ? '' : url.slice(questionMarkIndex + 1)
}

/**
 * A query string parsed with every value kept as the text it was sent as.
 * @param {string | undefined | null} queryString
 * @returns {Record<string, any>}
 */
export const rawQueryOf = (queryString) => qs.parse(queryString || '', QUERY_STRING_PARSE_OPTIONS)

/**
 * One text guessed the way the engine always guessed: number-looking text a number, `true`/`false` booleans.
 * @param {string} text
 * @returns {string | number | boolean}
 */
export const guessedValueOf = (text) => {
  if (NUMBER_LOOKING_TEXT.test(text)) {
    const number = Number(text)
    if (!Number.isNaN(number)) {
      return number
    }
  }
  if (text === 'false') {
    return false
  }
  if (text === 'true') {
    return true
  }
  return text
}

/**
 * A raw value (text, an array or an object of them, as `rawQueryOf` gives) with every text in it guessed.
 * @param {any} rawValue
 * @returns {any}
 */
export const guessedQueryValuesOf = (rawValue) => {
  if (typeof rawValue === 'string') {
    return guessedValueOf(rawValue)
  }
  if (Array.isArray(rawValue)) {
    return rawValue.map(guessedQueryValuesOf)
  }
  if (rawValue && typeof rawValue === 'object') {
    /** @type {Record<string, any>} */
    const guessed = {}
    for (const [key, value] of Object.entries(rawValue)) {
      guessed[key] = guessedQueryValuesOf(value)
    }
    return guessed
  }
  return rawValue
}

/**
 * The function Express calls to parse a query string into `request.query` (`app.set('query parser', ...)`).
 * @param {object} props
 * @param {boolean} props.isQueryValueGuessingEnabled
 * @returns {(queryString: string) => Record<string, any>}
 */
export const createQueryParser = ({ isQueryValueGuessingEnabled }) => (queryString) => {
  const rawQuery = rawQueryOf(queryString)
  return isQueryValueGuessingEnabled ? guessedQueryValuesOf(rawQuery) : rawQuery
}
