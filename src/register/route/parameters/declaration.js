import { problemOfTypedValue } from './coercion.js'

// A route declares the type of its query string's parameters in `schema.queryString`, one entry per parameter:
//
//   schema: {
//     queryString: {
//       id: 'string',                                              // shorthand: the type alone
//       ids: 'string[]',                                           // shorthand: a list of that type
//       includeContentLive: { type: 'boolean', default: false },
//       pageSize: { type: 'integer', default: 10, minimum: 1, maximum: 100 },
//       sort: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
//       slug: { type: 'string', isRequired: true, maxLength: 200 },
//       visibilities: { type: 'array', items: 'string', default: ['published'] },
//       filter: { type: 'object', properties: { status: 'string', isPinned: 'boolean' } },
//       payload: 'any',                                            // free-form: the value as sent, nothing read into it
//       '*': 'guessed',                                            // every parameter not named above (see below)
//     },
//   }
//
// `'*'` declares every parameter the route does not name: `'guessed'` keeps the engine's former guess for them (a route
// part-way through its migration, or one whose handler hands `params` on whole), `'any'` keeps them as sent, `'string'`
// reads each as text. Without it, a parameter the route does not name is read as the engine option
// `isQueryValueGuessingEnabled` says (options/index.js).
//
// The words are JSON Schema's (`type`, `default`, `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `items`,
// `minItems`, `maxItems`, `properties`, `description`), except `isRequired`, which JSON Schema writes as a list on the
// object: a flag on the parameter reads where the parameter is. A declaration the engine cannot read is logged when the
// route is defined and never fails the boot: an unknown type leaves the parameter undeclared (read as before), an
// unknown word is ignored, a default that breaks its own declaration is dropped.

export const PARAMETER_TYPES = ['boolean', 'integer', 'number', 'string', 'array', 'object', 'any', 'guessed']

// The name of the entry that declares every parameter a route does not name (`'*': 'guessed'`, `'*': 'any'`).
export const EVERY_OTHER_PARAMETER = '*'

const KEYWORDS_OF_EVERY_TYPE = ['type', 'default', 'enum', 'isRequired', 'description']
const KEYWORDS_BY_TYPE = {
  boolean: [],
  integer: ['minimum', 'maximum'],
  number: ['minimum', 'maximum'],
  string: ['minLength', 'maxLength'],
  array: ['items', 'minItems', 'maxItems'],
  object: ['properties'],
  any: [],
  guessed: [],
}

// Words other frameworks or older Servable declarations use, with the one meant.
const KEYWORD_HINTS = {
  defaultValue: 'default',
  required: 'isRequired',
}

/**
 * @typedef {object} RouteParameterDeclaration
 * @property {'boolean' | 'integer' | 'number' | 'string' | 'array' | 'object' | 'any' | 'guessed'} type
 * @property {any} [default] - the value the handler gets when the request does not give one.
 * @property {any[]} [enum] - the only values accepted, after the value is read as its type.
 * @property {boolean} [isRequired] - a request without it is refused (400); meaningless with a `default`.
 * @property {string} [description]
 * @property {number} [minimum] - integer and number.
 * @property {number} [maximum] - integer and number.
 * @property {number} [minLength] - string.
 * @property {number} [maxLength] - string.
 * @property {RouteParameterDeclaration | string} [items] - array: the type of each item (text when not declared).
 * @property {number} [minItems] - array.
 * @property {number} [maxItems] - array.
 * @property {Record<string, RouteParameterDeclaration | string>} [properties] - object: its declared properties.
 */

/**
 * A declaration written as a shorthand (`'integer'`, `'string[]'`) or in full, as the full form, checked. Answers the
 * declaration (or `null` when it cannot be read at all) and what is wrong with it.
 * @param {object} props
 * @param {any} props.declaration
 * @param {string} props.path - the parameter's name, dotted for a property or an item, for the messages.
 * @returns {{ declaration: RouteParameterDeclaration | null, problems: string[] }}
 */
export const normalizedDeclarationOf = ({ declaration, path }) => {
  /** @type {string[]} */
  const problems = []
  let full = declaration
  if (typeof declaration === 'string') {
    const shorthand = declaration.trim()
    full = shorthand.endsWith('[]')
      ? { type: 'array', items: shorthand.slice(0, -2).trim() }
      : { type: shorthand }
  }
  if (!full || typeof full !== 'object' || Array.isArray(full)) {
    return { declaration: null, problems: [`"${path}": a declaration is a type name or an object with a type, not ${JSON.stringify(declaration)}`] }
  }
  if (!PARAMETER_TYPES.includes(full.type)) {
    return { declaration: null, problems: [`"${path}": unknown type ${JSON.stringify(full.type)} (one of ${PARAMETER_TYPES.join(', ')}); the parameter is read as if undeclared`] }
  }

  /** @type {any} */
  const normalized = { type: full.type }
  const knownKeywords = [...KEYWORDS_OF_EVERY_TYPE, ...KEYWORDS_BY_TYPE[full.type]]
  for (const [keyword, value] of Object.entries(full)) {
    if (!knownKeywords.includes(keyword)) {
      const hint = KEYWORD_HINTS[keyword] ? `; did you mean "${KEYWORD_HINTS[keyword]}"?` : ''
      problems.push(`"${path}": "${keyword}" is not a word of a ${full.type} declaration and is ignored${hint}`)
      continue
    }
    if (keyword === 'type' || keyword === 'default') {
      continue
    }
    if (['minimum', 'maximum'].includes(keyword) && (typeof value !== 'number' || !Number.isFinite(value))) {
      problems.push(`"${path}": "${keyword}" must be a number and is ignored`)
      continue
    }
    if (['minLength', 'maxLength', 'minItems', 'maxItems'].includes(keyword) && !(Number.isSafeInteger(value) && value >= 0)) {
      problems.push(`"${path}": "${keyword}" must be a whole number, 0 or more, and is ignored`)
      continue
    }
    if (keyword === 'isRequired' && typeof value !== 'boolean') {
      problems.push(`"${path}": "isRequired" must be true or false and is ignored`)
      continue
    }
    if (keyword === 'enum' && !(Array.isArray(value) && value.length)) {
      problems.push(`"${path}": "enum" must be a list of the accepted values and is ignored`)
      continue
    }
    normalized[keyword] = value
  }

  if (normalized.type === 'array') {
    const items = normalizedDeclarationOf({ declaration: full.items === undefined ? 'string' : full.items, path: `${path}[]` })
    problems.push(...items.problems)
    normalized.items = items.declaration || { type: 'string' }
  }

  if (normalized.type === 'object') {
    /** @type {Record<string, RouteParameterDeclaration>} */
    const properties = {}
    const declaredProperties = full.properties === undefined ? {} : full.properties
    if (!declaredProperties || typeof declaredProperties !== 'object' || Array.isArray(declaredProperties)) {
      problems.push(`"${path}": "properties" must be an object of declarations and is ignored`)
    } else {
      for (const [name, propertyDeclaration] of Object.entries(declaredProperties)) {
        const property = normalizedDeclarationOf({ declaration: propertyDeclaration, path: `${path}.${name}` })
        problems.push(...property.problems)
        if (property.declaration) {
          properties[name] = property.declaration
        }
      }
    }
    normalized.properties = properties
  }

  if (normalized.enum) {
    const valuesOutsideTheType = normalized.enum.filter((value) => problemOfTypedValue({ value, declaration: { type: normalized.type, items: normalized.items, properties: normalized.properties } }))
    if (valuesOutsideTheType.length) {
      problems.push(`"${path}": "enum" holds values that are not of type ${normalized.type} (${valuesOutsideTheType.map((value) => JSON.stringify(value)).join(', ')}) and is ignored`)
      delete normalized.enum
    }
  }

  if ('default' in full) {
    const problemOfTheDefault = problemOfTypedValue({ value: full.default, declaration: normalized })
    if (problemOfTheDefault) {
      problems.push(`"${path}": the default ${JSON.stringify(full.default)} breaks its own declaration (${problemOfTheDefault}) and is ignored`)
    } else {
      normalized.default = full.default
    }
  }

  return { declaration: normalized, problems }
}

/**
 * A route's `schema.queryString`, every parameter in its full form. Parameters whose declaration cannot be read are left
 * out (they are read as undeclared) and named in `problems`.
 * @param {object} props
 * @param {any} props.queryStringDeclaration
 * @returns {{ parameters: Record<string, RouteParameterDeclaration>, everyOtherParameter?: RouteParameterDeclaration | null, problems: string[] }}
 */
export const compiledQueryStringDeclarationOf = ({ queryStringDeclaration }) => {
  /** @type {Record<string, RouteParameterDeclaration>} */
  const parameters = {}
  /** @type {string[]} */
  const problems = []
  if (queryStringDeclaration === undefined || queryStringDeclaration === null) {
    return { parameters, everyOtherParameter: null, problems }
  }
  if (typeof queryStringDeclaration !== 'object' || Array.isArray(queryStringDeclaration)) {
    return { parameters, everyOtherParameter: null, problems: ['"schema.queryString" must be an object of declarations, one per parameter, and is ignored'] }
  }
  /** @type {RouteParameterDeclaration | null} */
  let everyOtherParameter = null
  for (const [name, declaration] of Object.entries(queryStringDeclaration)) {
    const normalized = normalizedDeclarationOf({ declaration, path: name })
    problems.push(...normalized.problems)
    if (!normalized.declaration) {
      continue
    }
    if (name === EVERY_OTHER_PARAMETER) {
      const { type, description } = normalized.declaration
      if ('default' in normalized.declaration || normalized.declaration.isRequired) {
        problems.push(`"${EVERY_OTHER_PARAMETER}": a default or isRequired names no parameter and is ignored`)
      }
      everyOtherParameter = { ...normalized.declaration, type }
      delete everyOtherParameter.default
      delete everyOtherParameter.isRequired
      if (description === undefined) {
        delete everyOtherParameter.description
      }
      continue
    }
    parameters[name] = normalized.declaration
  }
  return { parameters, everyOtherParameter, problems }
}
