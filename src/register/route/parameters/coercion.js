import { guessedQueryValuesOf } from './queryString.js'

// Reading one parameter of a query string as the type its route declared (parameters/declaration.js). A query string
// carries text only, so the engine reads the text once, here, before the handler:
//
//   boolean   true, 1, yes, on and false, 0, no, off, in any case, spaces around ignored
//   integer   an optional sign and digits, within JavaScript's safe integers
//   number    a decimal number (`-1.5`, `.5`, `2e3`), finite; never `0x10`, `Infinity` or `NaN`
//   string    the text as it was sent, never turned into a number or a boolean
//   array     every value given under the name (`a=1&a=2`, `a[]=1`, `a[0]=1`), one value making a list of one, each
//             read as `items` (text when `items` is not declared)
//   object    the dotted or bracketed properties (`filter.status=live`), each declared property read as its type, the
//             others kept as text
//   any       the value as sent, text or a list or an object of text, nothing read into it (a free-form payload)
//   guessed   the engine's former guess (number-looking text a number, `true`/`false` booleans): a route that declares a
//             parameter this way keeps today's behaviour while the app types it
//
// An empty value (`?limit=` or `?limit`) is no value for every type but `string` and `any`: the default applies.

const BOOLEAN_YES_WORDS = new Set(['true', '1', 'yes', 'on'])
const BOOLEAN_NO_WORDS = new Set(['false', '0', 'no', 'off'])
const INTEGER_TEXT = /^[+-]?\d+$/
const NUMBER_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
const LONGEST_VALUE_QUOTED_IN_A_MESSAGE = 60

const EXPECTATION_BY_TYPE = {
  boolean: 'true or false (also 1/0, yes/no, on/off)',
  integer: 'an integer',
  number: 'a number',
  string: 'one text value',
  array: 'a list',
  object: 'an object (name.property=value)',
}

/**
 * A value as it reads in an error message: quoted, and cut when long.
 * @param {any} value
 * @returns {string}
 */
export const quotedValueOf = (value) => {
  const quoted = JSON.stringify(value) ?? String(value)
  return quoted.length > LONGEST_VALUE_QUOTED_IN_A_MESSAGE ? `${quoted.slice(0, LONGEST_VALUE_QUOTED_IN_A_MESSAGE)}…` : quoted
}

/**
 * Whether a raw value counts as not given: empty text, for a type other than string and any.
 * @param {object} props
 * @param {any} props.rawValue
 * @param {{ type: string }} props.declaration
 * @returns {boolean}
 */
export const isRawValueEmptyFor = ({ rawValue, declaration }) => rawValue === undefined
  || (rawValue === '' && !['string', 'any'].includes(declaration.type))

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * What is wrong with an already-typed value (a default, an item of `enum`, a value read from text) against a
 * declaration's type and limits, or `null` when nothing is.
 * @param {object} props
 * @param {any} props.value
 * @param {any} props.declaration
 * @returns {string | null}
 */
export const problemOfTypedValue = ({ value, declaration }) => {
  const { type } = declaration
  switch (type) {
    case 'boolean': {
      if (typeof value !== 'boolean') {
        return `expected ${EXPECTATION_BY_TYPE.boolean}`
      }
      break
    }
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isSafeInteger(value))) {
        return `expected ${EXPECTATION_BY_TYPE[type]}`
      }
      if (typeof declaration.minimum === 'number' && value < declaration.minimum) {
        return `expected ${declaration.minimum} or more`
      }
      if (typeof declaration.maximum === 'number' && value > declaration.maximum) {
        return `expected ${declaration.maximum} or less`
      }
      break
    }
    case 'string': {
      if (typeof value !== 'string') {
        return `expected ${EXPECTATION_BY_TYPE.string}`
      }
      if (typeof declaration.minLength === 'number' && value.length < declaration.minLength) {
        return `expected at least ${declaration.minLength} characters`
      }
      if (typeof declaration.maxLength === 'number' && value.length > declaration.maxLength) {
        return `expected at most ${declaration.maxLength} characters`
      }
      break
    }
    case 'array': {
      if (!Array.isArray(value)) {
        return `expected ${EXPECTATION_BY_TYPE.array}`
      }
      if (typeof declaration.minItems === 'number' && value.length < declaration.minItems) {
        return `expected at least ${declaration.minItems} values`
      }
      if (typeof declaration.maxItems === 'number' && value.length > declaration.maxItems) {
        return `expected at most ${declaration.maxItems} values`
      }
      if (declaration.items) {
        for (const item of value) {
          const problemOfTheItem = problemOfTypedValue({ value: item, declaration: declaration.items })
          if (problemOfTheItem) {
            return `an item: ${problemOfTheItem}`
          }
        }
      }
      break
    }
    case 'object': {
      if (!isPlainObject(value)) {
        return `expected ${EXPECTATION_BY_TYPE.object}`
      }
      for (const [name, propertyDeclaration] of Object.entries(declaration.properties || {})) {
        if (value[name] === undefined) {
          if (propertyDeclaration.isRequired && !('default' in propertyDeclaration)) {
            return `"${name}" is required`
          }
          continue
        }
        const problemOfTheProperty = problemOfTypedValue({ value: value[name], declaration: propertyDeclaration })
        if (problemOfTheProperty) {
          return `"${name}": ${problemOfTheProperty}`
        }
      }
      break
    }
    default:
      break
  }
  if (Array.isArray(declaration.enum) && !declaration.enum.some((accepted) => accepted === value)) {
    return `expected one of ${declaration.enum.map(quotedValueOf).join(', ')}`
  }
  return null
}

/**
 * A copy of a default, so a handler changing the list or object it was given never changes the next request's.
 * @param {any} value
 * @returns {any}
 */
export const copyOfDefault = (value) => (value && typeof value === 'object' ? structuredClone(value) : value)

/**
 * The items of a raw list: an array as it is, one value as a list of one, the object qs makes of indexes above its
 * array limit (`a[25]=x`) in the order of its indexes.
 * @param {any} rawValue
 * @returns {any[] | null}
 */
const rawItemsOf = (rawValue) => {
  if (Array.isArray(rawValue)) {
    return rawValue
  }
  if (typeof rawValue === 'string') {
    return [rawValue]
  }
  if (isPlainObject(rawValue)) {
    const indexes = Object.keys(rawValue)
    if (indexes.length && indexes.every((index) => /^\d+$/.test(index))) {
      return indexes.map(Number).sort((first, second) => first - second).map((index) => rawValue[String(index)])
    }
  }
  return null
}

/**
 * One raw value (text, or the list or object qs made) read as its declaration says, its limits checked.
 * @param {object} props
 * @param {any} props.rawValue - never undefined and never empty for a type that treats empty as not given.
 * @param {any} props.declaration - a normalized declaration (declaration.js).
 * @param {string} props.path - the parameter's name, for the messages.
 * @returns {{ value: any, problem?: undefined } | { problem: string, value?: undefined }}
 */
export const coercedValueOf = ({ rawValue, declaration, path }) => {
  const refused = (expectation) => ({ problem: `"${path}" must be ${expectation}, got ${quotedValueOf(rawValue)}` })
  const { type } = declaration

  if (type === 'any') {
    return { value: rawValue }
  }
  if (type === 'guessed') {
    return { value: guessedQueryValuesOf(rawValue) }
  }

  let value
  switch (type) {
    case 'boolean': {
      if (typeof rawValue !== 'string') {
        return refused(EXPECTATION_BY_TYPE.boolean)
      }
      const word = rawValue.trim().toLowerCase()
      if (BOOLEAN_YES_WORDS.has(word)) {
        value = true
      } else if (BOOLEAN_NO_WORDS.has(word)) {
        value = false
      } else {
        return refused(EXPECTATION_BY_TYPE.boolean)
      }
      break
    }
    case 'integer':
    case 'number': {
      if (typeof rawValue !== 'string') {
        return refused(EXPECTATION_BY_TYPE[type])
      }
      const text = rawValue.trim()
      if (!(type === 'integer' ? INTEGER_TEXT : NUMBER_TEXT).test(text)) {
        return refused(EXPECTATION_BY_TYPE[type])
      }
      value = Number(text)
      if (!Number.isFinite(value) || (type === 'integer' && !Number.isSafeInteger(value))) {
        return refused(EXPECTATION_BY_TYPE[type])
      }
      break
    }
    case 'string': {
      if (typeof rawValue !== 'string') {
        return refused(EXPECTATION_BY_TYPE.string)
      }
      value = rawValue
      break
    }
    case 'array': {
      const rawItems = rawItemsOf(rawValue)
      if (!rawItems) {
        return refused(EXPECTATION_BY_TYPE.array)
      }
      value = []
      for (const [index, rawItem] of rawItems.entries()) {
        const item = coercedValueOf({ rawValue: rawItem, declaration: declaration.items, path: `${path}[${index}]` })
        if (item.problem) {
          return item
        }
        value.push(item.value)
      }
      break
    }
    case 'object': {
      if (!isPlainObject(rawValue)) {
        return refused(EXPECTATION_BY_TYPE.object)
      }
      const read = readDeclaredValues({ rawValues: rawValue, declarations: declaration.properties || {}, readUndeclaredValue: (rawPropertyValue) => rawPropertyValue, pathPrefix: `${path}.` })
      if (read.problems.length) {
        return { problem: read.problems.join('; ') }
      }
      value = read.values
      break
    }
    default:
      return { value: rawValue }
  }

  const problemOfTheValue = problemOfTypedValue({ value, declaration: { ...declaration, items: undefined, properties: undefined } })
  if (problemOfTheValue) {
    return { problem: `"${path}": ${problemOfTheValue}, got ${quotedValueOf(rawValue)}` }
  }
  return { value }
}

/**
 * Every value of a raw object read: the declared ones as declared (default when not given, refused when required and
 * not given), the others through `readUndeclaredValue`.
 * @param {object} props
 * @param {Record<string, any>} props.rawValues
 * @param {Record<string, any>} props.declarations
 * @param {(rawValue: any) => any} props.readUndeclaredValue
 * @param {string} [props.pathPrefix]
 * @returns {{ values: Record<string, any>, problems: string[] }}
 */
export const readDeclaredValues = ({ rawValues, declarations, readUndeclaredValue, pathPrefix = '' }) => {
  /** @type {Record<string, any>} */
  const values = {}
  /** @type {string[]} */
  const problems = []
  for (const [name, rawValue] of Object.entries(rawValues)) {
    if (!Object.prototype.hasOwnProperty.call(declarations, name)) {
      values[name] = readUndeclaredValue(rawValue)
    }
  }
  for (const [name, declaration] of Object.entries(declarations)) {
    const rawValue = Object.prototype.hasOwnProperty.call(rawValues, name) ? rawValues[name] : undefined
    if (isRawValueEmptyFor({ rawValue, declaration })) {
      if ('default' in declaration) {
        values[name] = copyOfDefault(declaration.default)
      } else if (declaration.isRequired) {
        problems.push(`"${pathPrefix}${name}" is required`)
      }
      continue
    }
    const read = coercedValueOf({ rawValue, declaration, path: `${pathPrefix}${name}` })
    if (read.problem) {
      problems.push(read.problem)
    } else {
      values[name] = read.value
    }
  }
  return { values, problems }
}
