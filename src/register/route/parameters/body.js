import { compiledBodyDeclarationOf } from './declaration.js'
import { copyOfDefault, problemOfTypedValue } from './coercion.js'

export { compiledBodyDeclarationOf }

// A route's JSON body, checked against its `schema.body` (owner's Q1720 a, 2026-11-24; docs/typed-route-parameters.md,
// "Declared bodies"). The declaration uses the words of `schema.queryString` (declaration.js), but a JSON body already
// carries its types, so a value is checked, never converted:
//
//   boolean   true or false, never "true" or 1
//   integer   a JSON number that is a safe integer
//   number    a JSON number
//   string    a JSON string
//   array     a JSON array, each item checked as `items` (any value when `items` is not declared); one value is not a
//             list of one, as it is in a query string
//   object    a JSON object, its declared properties checked, the others kept as sent
//   any       anything (`guessed` in a body is read as `any`)
//
// `null` and a missing field are both no value: the default applies, a required field is refused, and otherwise the
// field stays as sent. A field the route does not name is checked against its `'*'` entry, else kept as sent.
//
// A refusal names the field at fault and describes the value by its kind and size only, never quoting it: the body is
// where clients put what must stay out of URLs and logs (a token, a password), and refusals end up in logs.

const EXPECTATION_BY_TYPE = {
  boolean: 'true or false',
  integer: 'an integer',
  number: 'a number',
  string: 'text',
  array: 'a list',
  object: 'an object',
}

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * A JSON value described by its kind and size, never its content: what a refusal says it got.
 * @param {any} value
 * @returns {string}
 */
export const descriptionOfBodyValue = (value) => {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return `a list of ${value.length}`
  }
  switch (typeof value) {
    case 'string':
      return `text of ${value.length} character${value.length === 1 ? '' : 's'}`
    case 'number':
      return 'a number'
    case 'boolean':
      return 'a boolean'
    case 'object':
      return 'an object'
    default:
      return typeof value
  }
}

/**
 * Whether a JSON value is of a declared type, its limits aside.
 * @param {any} value
 * @param {string} type
 * @returns {boolean}
 */
const isValueOfType = (value, type) => {
  switch (type) {
    case 'boolean':
      return typeof value === 'boolean'
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value)
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'string':
      return typeof value === 'string'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isPlainObject(value)
    default:
      return true
  }
}

/**
 * One value of a body checked against its declaration: the value (a nested object's defaults applied), or every
 * problem found in it.
 * @param {object} props
 * @param {any} props.value - neither undefined nor null.
 * @param {any} props.declaration - a normalized declaration (declaration.js, source `body`).
 * @param {string} props.path - the field's name, dotted for a property, indexed for an item, for the messages.
 * @returns {{ value: any, problems: string[] }}
 */
export const checkedBodyValueOf = ({ value, declaration, path }) => {
  const { type } = declaration
  if (type === 'any' || type === 'guessed') {
    return { value, problems: [] }
  }
  if (!isValueOfType(value, type)) {
    return { value, problems: [`"${path}": expected ${EXPECTATION_BY_TYPE[type]}, got ${descriptionOfBodyValue(value)}`] }
  }

  // The limits of the value itself (lengths, bounds, counts, enum), its items and properties checked below.
  const problemOfTheLimits = problemOfTypedValue({ value, declaration: { ...declaration, items: undefined, properties: undefined } })
  if (problemOfTheLimits) {
    return { value, problems: [`"${path}": ${problemOfTheLimits}, got ${descriptionOfBodyValue(value)}`] }
  }

  if (type === 'array') {
    const items = []
    for (const [index, item] of value.entries()) {
      if (item === undefined || item === null) {
        items.push(item)
        continue
      }
      const checkedItem = checkedBodyValueOf({ value: item, declaration: declaration.items, path: `${path}[${index}]` })
      if (checkedItem.problems.length) {
        return { value, problems: checkedItem.problems }
      }
      items.push(checkedItem.value)
    }
    return { value: items, problems: [] }
  }

  if (type === 'object') {
    return checkedBodyFieldsOf({ fields: value, declarations: declaration.properties || {}, everyOtherField: null, pathPrefix: `${path}.` })
  }

  return { value, problems: [] }
}

/**
 * Every field of an object checked: the declared ones as declared (default when no value, refused when required and
 * no value), the others against `everyOtherField` when there is one, else kept as sent.
 * @param {object} props
 * @param {Record<string, any>} props.fields
 * @param {Record<string, any>} props.declarations
 * @param {any} props.everyOtherField - the `'*'` declaration, or null.
 * @param {string} [props.pathPrefix]
 * @returns {{ value: Record<string, any>, problems: string[] }}
 */
const checkedBodyFieldsOf = ({ fields, declarations, everyOtherField, pathPrefix = '' }) => {
  /** @type {Record<string, any>} */
  const values = {}
  /** @type {string[]} */
  const problems = []
  for (const [name, value] of Object.entries(fields)) {
    if (Object.prototype.hasOwnProperty.call(declarations, name)) {
      continue
    }
    if (!everyOtherField || value === null || value === undefined) {
      values[name] = value
      continue
    }
    const checked = checkedBodyValueOf({ value, declaration: everyOtherField, path: `${pathPrefix}${name}` })
    problems.push(...checked.problems)
    values[name] = checked.value
  }
  for (const [name, declaration] of Object.entries(declarations)) {
    const value = Object.prototype.hasOwnProperty.call(fields, name) ? fields[name] : undefined
    if (value === undefined || value === null) {
      if ('default' in declaration) {
        values[name] = copyOfDefault(declaration.default)
      } else if (declaration.isRequired) {
        problems.push(`"${pathPrefix}${name}" is required`)
      } else if (value === null) {
        values[name] = null
      }
      continue
    }
    const checked = checkedBodyValueOf({ value, declaration, path: `${pathPrefix}${name}` })
    problems.push(...checked.problems)
    values[name] = checked.value
  }
  return { value: values, problems }
}

/**
 * A parsed body checked against a compiled `schema.body` (`compiledBodyDeclarationOf`).
 * @param {object} props
 * @param {Record<string, any>} props.body - a JSON object.
 * @param {Record<string, any>} props.fields
 * @param {any} [props.everyOtherField]
 * @returns {{ values: Record<string, any>, problems: string[] }}
 */
export const checkedBodyOf = ({ body, fields, everyOtherField = null }) => {
  const { value, problems } = checkedBodyFieldsOf({ fields: body, declarations: fields, everyOtherField })
  return { values: value, problems }
}

/**
 * The JSON object a request's body holds: the raw buffer (or text) `bodyParser.raw` handed over, parsed once; an object
 * some earlier middleware already parsed, as it is; nothing (another content type, an empty body) as `{}`. Throws a 400
 * for text that is not JSON, and for JSON that is not an object.
 * @param {any} rawBody
 * @returns {Record<string, any>}
 */
export const parsedBodyOf = (rawBody) => {
  if (rawBody === undefined || rawBody === null) {
    return {}
  }
  let parsed = rawBody
  if (Buffer.isBuffer(rawBody) || typeof rawBody === 'string') {
    const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody
    if (!text.trim()) {
      return {}
    }
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw { code: 400, message: 'Invalid body: not JSON' }
    }
  }
  if (!isPlainObject(parsed)) {
    throw { code: 400, message: `Invalid body: expected a JSON object, got ${descriptionOfBodyValue(parsed)}` }
  }
  return parsed
}
