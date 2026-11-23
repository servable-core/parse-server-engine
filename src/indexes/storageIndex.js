// What an index declared in Servable's terms becomes in MongoDB: its keys under their storage names, and its options.
// Pure, so it is tested without a database.
//
// A declaration (in a schema.json's `ensuredIndexes`, or given to `Servable.App.Indexes.ensure`) names fields as the app
// does: `objectId`, `createdAt`, a pointer by its own name (`audio`), a dotted path into an object (`content.media.id`).
// Parse stores some of them under another name (`_id`, `_created_at`, `_p_audio`); its own `transformKey` says which, from
// the field's type, so a pointer field must be declared in the class's schema or typed in the declaration's `fieldTypes`.
//
// Options are those Parse gives the indexes it makes itself (MongoStorageAdapter `ensureIndex`, `ensureUniqueness`):
// built in the background and sparse (a row without the field is not in the index), so an index this engine made before
// from the same declaration is found identical, and making it again changes nothing.

const INDEX_DIRECTIONS = [1, -1]

/** @param {unknown} value */
const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype

/**
 * The problems of a declaration, in words; none when it can be made.
 * @param {any} declaration
 * @returns {string[]}
 */
export const problemsOfTheDeclaration = (declaration) => {
  if (!isPlainObject(declaration)) {
    return ['the declaration is not an object']
  }
  const problems = []
  const { keys, isUnique, isSparse, partialFilter, fieldTypes } = declaration
  if (!isPlainObject(keys) || Object.keys(keys).length === 0) {
    problems.push('`keys` names no field')
  } else {
    Object.entries(keys)
      .filter(([, direction]) => !INDEX_DIRECTIONS.includes(direction))
      .forEach(([fieldName]) => problems.push(`the direction of \`${fieldName}\` is neither 1 nor -1`))
  }
  if (isUnique !== undefined && typeof isUnique !== 'boolean') {
    problems.push('`isUnique` is not a boolean')
  }
  if (isSparse !== undefined && typeof isSparse !== 'boolean') {
    problems.push('`isSparse` is not a boolean')
  }
  if (partialFilter !== undefined && !isPlainObject(partialFilter)) {
    problems.push('`partialFilter` is not an object')
  }
  if (partialFilter !== undefined && isSparse === true) {
    problems.push('an index is either sparse or partial, not both')
  }
  if (fieldTypes !== undefined && !isPlainObject(fieldTypes)) {
    problems.push('`fieldTypes` is not an object')
  }
  const knownNames = ['keys', 'isUnique', 'isSparse', 'partialFilter', 'fieldTypes']
  Object.keys(declaration).filter((name) => !knownNames.includes(name)).forEach((name) => problems.push(`\`${name}\` is not an option of an ensured index`))
  return problems
}

/**
 * The storage name of each field name in a partial filter, operators and their values left as written.
 * @param {any} filter
 * @param {(fieldName: string) => string} storageNameOf
 * @returns {any}
 */
const storageFilterFrom = (filter, storageNameOf) => Object.fromEntries(Object.entries(filter).map(([name, value]) => {
  if (name.startsWith('$')) {
    return [name, Array.isArray(value) ? value.map((item) => (isPlainObject(item) ? storageFilterFrom(item, storageNameOf) : item)) : value]
  }
  return [storageNameOf(name), value]
}))

/**
 * @param {object} props
 * @param {string} props.className
 * @param {string} props.name
 * @param {any} props.declaration - `{ keys, isUnique?, isSparse?, partialFilter?, fieldTypes? }`
 * @param {Record<string, any>} [props.declaredFields] - the class's fields, from its schema.
 * @param {(className: string, fieldName: string, schema: { fields: Record<string, any> }) => string} props.transformKey - Parse's.
 * @returns {{ keys: Record<string, number>, options: Record<string, any> }}
 */
export const storageIndexFrom = ({ className, name, declaration, declaredFields = {}, transformKey }) => {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error(`an ensured index of ${className} has no name`)
  }
  const problems = problemsOfTheDeclaration(declaration)
  if (problems.length > 0) {
    throw new Error(`the ensured index ${className}.${name} cannot be made: ${problems.join('; ')}`)
  }
  const { keys, isUnique = false, partialFilter, fieldTypes = {} } = declaration
  const isSparse = declaration.isSparse ?? partialFilter === undefined
  const schema = { fields: { ...declaredFields, ...fieldTypes } }
  /** @param {string} fieldName */
  const storageNameOf = (fieldName) => transformKey(className, fieldName, schema)

  /** @type {Record<string, number>} */
  const storageKeys = {}
  for (const [fieldName, direction] of Object.entries(keys)) {
    storageKeys[storageNameOf(fieldName)] = direction
  }
  return {
    keys: storageKeys,
    options: {
      name,
      background: true,
      ...(isSparse ? { sparse: true } : {}),
      ...(isUnique ? { unique: true } : {}),
      ...(partialFilter ? { partialFilterExpression: storageFilterFrom(partialFilter, storageNameOf) } : {}),
    },
  }
}
