import crypto from 'crypto'
import { createRequire } from 'module'
import { COLLECTIONS } from '../stateStore/collections.js'

// Parse Server's schema migration skipped when nothing it would apply has changed (framework audit 2026-11-23, F4).
//
// Every boot hands the class definitions to Parse Server (`schema.definitions`), and Parse's DefinedSchemas then
// rewrites every class and reloads every schema after each write, before the server is ready: for backend/main's 176
// classes, 380 `_SCHEMA` updates and 350 full reads, 4.3 s on an idle MongoDB, up to 11.6 s loaded, even when the
// definitions have not changed since the last boot.
//
// The migration converges the database's schema (`_SCHEMA`) to the definitions. It is deterministic: the same
// definitions, the same Parse Server and the same `_SCHEMA` give the same `_SCHEMA` after it. So once a run has
// completed AND changed nothing in `_SCHEMA`, every later run on that same state would change nothing either. (A run
// that changed something is not enough: on backend/main's definitions the first run on an empty database leaves
// `_SCHEMA` one step short, the second adds Parse's own `_id_` index entries, the third changes nothing;
// tests/integration/schemaMigration.test.js.) After each completed run the engine records:
//
//   - the definitions' hash: the definitions exactly as Parse receives them, the schema options that steer the
//     migration, and Parse Server's version (an upgrade may migrate differently);
//   - the database schema's hash: every `_SCHEMA` document as the run left it;
//   - whether the run changed nothing (`_SCHEMA`'s hash the same before and after it).
//
// The next boot skips the migration only when the last completed run changed nothing and both hashes are the same
// again: then the skipped run is exactly one that has been seen to change nothing. Anything else runs it: changed
// definitions, a changed `_SCHEMA` (a field Parse added at run time, a class created or dropped, a restore, a hand
// edit), a Parse Server upgrade, no record yet, a record or a hash that cannot be read, or the run forced
// (`isSchemaMigrationForced`, SERVABLE_FORCE_SCHEMA_MIGRATION). A record is written only after a migration that
// completed: Parse's own DefinedSchemas logs a failure and carries on outside production, so completion is observed
// directly (patch below), never assumed.
//
// `ensuredIndexes` are not part of the definitions Parse receives (launch strips them): the engine makes them after
// every boot, separately, whatever this step decides.
//
// Indexes Parse did not declare stay out of its reach (owner's Q1470 a, 2026-11-24). DefinedSchemas deletes every index
// of a class that the definitions do not declare, and so dropped the engine's own (a schema's `ensuredIndexes`,
// `_Session._session_token_1`, those `Servable.App.Indexes.ensure` makes at run time) and any made by hand. It did so
// every other boot only, because it compares the definitions with the schema cache Parse loaded BEFORE its start copied
// the real indexes into `_SCHEMA` (`updateSchemaWithIndexes`): a boot that found `key_1` listed dropped it and wrote
// `_SCHEMA` without it, the engine made it again after boot, the next boot found it unlisted, deleted nothing and wrote
// the real list back. `_SCHEMA` flipped between two states, no run ever changed nothing, nothing was ever skipped, and a
// unique index was missing between each drop and its rebuild. Now the hook on `isProtectedIndex` keeps from deletion
// every index the definitions do not declare, unless they declared it at the last completed run (recorded with it):
// Parse still drops an index removed from the definitions, and still remakes a declared one whose keys changed, but
// never one it did not make. With no record of what was declared before, nothing undeclared is deleted.

const PARSE_SCHEMA_STATE_KEY = 'parse-definitions'
const DEFINITIONS_HASH_FORMAT = 1

const requireFromHere = createRequire(import.meta.url)

/** @returns {string | null} */
export const parseServerVersionOf = () => {
  try {
    return requireFromHere('parse-server/package.json').version
  } catch {
    return null
  }
}

// JSON with object keys sorted at every level, so the same content always hashes the same.
const sortedValueOf = (value) => {
  if (Array.isArray(value)) {
    return value.map(sortedValueOf)
  }
  if (value instanceof Date) {
    return { $date: value.toISOString() }
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedValueOf(value[key])]))
  }
  return value
}

export const stableStringify = (value) => JSON.stringify(sortedValueOf(value))

const sha256Of = (text) => crypto.createHash('sha256').update(text).digest('hex')

// The schema options that change what a migration does (doLaunch sets them).
const MIGRATION_SCHEMA_OPTION_NAMES = ['lockSchemas', 'strict', 'recreateModifiedFields', 'deleteExtraFields']

/**
 * @param {object} props
 * @param {Array<Record<string, any>>} props.definitions - exactly what Parse Server receives in `schema.definitions`.
 * @param {Record<string, any>} [props.schemaOptions]
 * @param {string | null} [props.parseServerVersion]
 * @returns {string}
 */
export const definitionsHashOf = ({ definitions, schemaOptions = {}, parseServerVersion = parseServerVersionOf() }) => sha256Of(stableStringify({
  format: DEFINITIONS_HASH_FORMAT,
  parseServerVersion,
  schemaOptions: Object.fromEntries(MIGRATION_SCHEMA_OPTION_NAMES.map((name) => [name, schemaOptions[name] ?? null])),
  // Parse applies the definitions class by class: their order does not matter, their content does.
  definitions: [...definitions].sort((a, b) => String(a.className).localeCompare(String(b.className))),
}))

/**
 * The hash of the database's schema: every `_SCHEMA` document.
 * @param {object} props
 * @param {import('mongodb').Db} props.db
 * @param {string} [props.collectionPrefix] - Parse's `collectionPrefix`.
 * @returns {Promise<string>}
 */
export const databaseSchemaHashOf = async ({ db, collectionPrefix = '' }) => {
  const documents = await db.collection(`${collectionPrefix}_SCHEMA`).find({}).sort({ _id: 1 }).toArray()
  return sha256Of(stableStringify(documents))
}

/**
 * Whether this boot runs Parse's schema migration.
 * @param {object} props
 * @param {boolean} props.isForced
 * @param {string} props.definitionsHash
 * @param {string | null} props.databaseSchemaHash - null when it could not be read.
 * @param {{ definitionsHash?: string, databaseSchemaHash?: string, hasChangedNothing?: boolean } | null} props.lastCompletedMigration
 * @returns {{ isMigrationRun: boolean, reason: string }}
 */
export const schemaMigrationDecisionOf = ({ isForced, definitionsHash, databaseSchemaHash, lastCompletedMigration }) => {
  if (isForced) {
    return { isMigrationRun: true, reason: 'forced' }
  }
  if (!lastCompletedMigration) {
    return { isMigrationRun: true, reason: 'no completed migration recorded' }
  }
  if (lastCompletedMigration.definitionsHash !== definitionsHash) {
    return { isMigrationRun: true, reason: 'definitions changed' }
  }
  if (!databaseSchemaHash || lastCompletedMigration.databaseSchemaHash !== databaseSchemaHash) {
    return { isMigrationRun: true, reason: 'database schema changed since the last migration' }
  }
  if (lastCompletedMigration.hasChangedNothing !== true) {
    return { isMigrationRun: true, reason: 'the last migration changed the database schema: a run that changes nothing comes first' }
  }
  return { isMigrationRun: false, reason: 'definitions and database schema unchanged since the last migration' }
}

/**
 * The names of the indexes each class declares to Parse (its definitions' `indexes`), sorted.
 * @param {Array<Record<string, any>>} definitions - what Parse Server receives in `schema.definitions`.
 * @returns {Record<string, string[]>}
 */
export const declaredIndexNamesByClassOf = (definitions) => Object.fromEntries((definitions || [])
  .filter((definition) => typeof definition?.className === 'string')
  .map((definition) => [definition.className, Object.keys(definition.indexes || {}).sort()]))

/**
 * The index names a map lists for a class; none when the map or its entry is not what it should be (a record read back).
 * @param {any} indexNamesByClass
 * @param {string} className
 * @returns {string[]}
 */
const indexNamesOf = (indexNamesByClass, className) => {
  const names = indexNamesByClass && typeof indexNamesByClass === 'object' && Object.hasOwn(indexNamesByClass, className) ? indexNamesByClass[className] : null
  return Array.isArray(names) ? names : []
}

/**
 * Whether Parse's migration must leave an index of a class where it is: true for every index the definitions do not
 * declare, unless they declared it at the last completed run (then it was Parse's, and removing it from the definitions
 * means dropping it). A declared index is never protected here (Parse remakes it when its keys changed).
 * @param {object} props
 * @param {string} props.className
 * @param {string} props.indexName
 * @param {Record<string, string[]>} props.declaredIndexNamesByClass - this boot's definitions.
 * @param {Record<string, string[]> | null | undefined} props.previouslyDeclaredIndexNamesByClass - the last completed
 *   run's; null when unknown (no record, or one written before this was recorded): then nothing undeclared is deleted.
 * @returns {boolean}
 */
export const isIndexProtectedFromTheMigration = ({ className, indexName, declaredIndexNamesByClass, previouslyDeclaredIndexNamesByClass }) => {
  if (indexNamesOf(declaredIndexNamesByClass, className).includes(indexName)) {
    return false
  }
  if (!previouslyDeclaredIndexNamesByClass || typeof previouslyDeclaredIndexNamesByClass !== 'object') {
    return true
  }
  return !indexNamesOf(previouslyDeclaredIndexNamesByClass, className).includes(indexName)
}

/**
 * The record of the last completed migration, in the engine's state collections.
 * @param {import('mongodb').Db} db
 */
export const lastCompletedMigrationStoreOf = (db) => ({
  read: () => /** @type {Promise<{ definitionsHash?: string, databaseSchemaHash?: string, hasChangedNothing?: boolean, declaredIndexNamesByClass?: Record<string, string[]> } | null>} */ (db.collection(COLLECTIONS.parseSchema).findOne({ key: PARSE_SCHEMA_STATE_KEY }, { projection: { _id: 0 } })),
  record: ({ definitionsHash, databaseSchemaHash, hasChangedNothing, parseServerVersion, declaredIndexNamesByClass }) => db.collection(COLLECTIONS.parseSchema).updateOne(
    { key: PARSE_SCHEMA_STATE_KEY },
    { $set: { key: PARSE_SCHEMA_STATE_KEY, definitionsHash, databaseSchemaHash, hasChangedNothing, parseServerVersion, declaredIndexNamesByClass, completedAt: new Date() } },
    { upsert: true },
  ),
})

// The DefinedSchemas patch: the engine's say over one run of Parse's migration, keyed by the schema options object
// Parse receives (Parse keeps that object as it is; an extra key in it would be logged as an invalid option).
const migrationControlsBySchemaOptions = new WeakMap()
let installedDefinedSchemas = null

/**
 * Installs, once, the three hooks on Parse's DefinedSchemas: skip `execute()` when the engine says so, tell the engine
 * when a run reached its last step (`enforceCLPForNonProvidedClass`, which only runs when every class before it was
 * saved), and keep the indexes Parse did not declare from deletion (`isProtectedIndex`). Without the hooks (another
 * Parse version), nothing is skipped, nothing is recorded and nothing is protected beyond Parse's own.
 * @param {any} [DefinedSchemas] - for tests; Parse Server's own by default.
 * @returns {{ isInstalled: boolean, reason?: string }}
 */
export const installTheMigrationControls = (DefinedSchemas) => {
  try {
    const Target = DefinedSchemas || requireFromHere('parse-server/lib/SchemaMigrations/DefinedSchemas.js').DefinedSchemas
    if (installedDefinedSchemas === Target) {
      return { isInstalled: true }
    }
    const { execute, enforceCLPForNonProvidedClass, isProtectedIndex } = Target?.prototype || {}
    if (typeof execute !== 'function' || typeof enforceCLPForNonProvidedClass !== 'function' || typeof isProtectedIndex !== 'function') {
      return { isInstalled: false, reason: 'DefinedSchemas has no execute/enforceCLPForNonProvidedClass/isProtectedIndex' }
    }
    Target.prototype.execute = async function executeUnlessSkipped(...args) {
      const controls = migrationControlsBySchemaOptions.get(this.schemaOptions)
      if (controls?.isSkipped) {
        controls.onSkipped?.()
        return undefined
      }
      return execute.apply(this, args)
    }
    Target.prototype.enforceCLPForNonProvidedClass = async function enforceThenTell(...args) {
      const answer = await enforceCLPForNonProvidedClass.apply(this, args)
      migrationControlsBySchemaOptions.get(this.schemaOptions)?.onCompleted?.()
      return answer
    }
    // Parse asks it before adding a declared index and before deleting one the definitions do not declare (or declare
    // with other keys): only the deletion of an undeclared one is refused (isIndexProtectedFromTheMigration).
    Target.prototype.isProtectedIndex = function isProtectedIndexOrOutOfReach(className, indexName, ...rest) {
      if (isProtectedIndex.call(this, className, indexName, ...rest)) {
        return true
      }
      return migrationControlsBySchemaOptions.get(this.schemaOptions)?.isIndexProtected?.(className, indexName) === true
    }
    installedDefinedSchemas = Target
    return { isInstalled: true }
  } catch (error) {
    return { isInstalled: false, reason: error?.message || String(error) }
  }
}

/**
 * @param {object} schemaOptions - the very object Parse Server receives as `schema`.
 * @param {{ isSkipped: boolean, onCompleted?: () => void, onSkipped?: () => void, isIndexProtected?: (className: string, indexName: string) => boolean }} controls
 */
export const controlTheMigrationOf = (schemaOptions, controls) => {
  migrationControlsBySchemaOptions.set(schemaOptions, controls)
}

/**
 * The controls of this boot's run, from its plan: what launch hands doLaunch.
 * @param {object} props
 * @param {{ isMigrationRun: boolean, declaredIndexNamesByClass?: Record<string, string[]>, previouslyDeclaredIndexNamesByClass?: Record<string, string[]> | null }} props.plan
 * @param {() => void} [props.onCompleted]
 */
export const migrationControlsOf = ({ plan, onCompleted }) => ({
  isSkipped: !plan.isMigrationRun,
  onCompleted,
  isIndexProtected: (/** @type {string} */ className, /** @type {string} */ indexName) => isIndexProtectedFromTheMigration({
    className,
    indexName,
    declaredIndexNamesByClass: plan.declaredIndexNamesByClass || {},
    previouslyDeclaredIndexNamesByClass: plan.previouslyDeclaredIndexNamesByClass ?? null,
  }),
})

/**
 * Before Parse starts: decides whether its migration runs. Never throws: whatever cannot be read means it runs.
 * @param {object} props
 * @param {import('mongodb').Db | null} props.db
 * @param {Array<Record<string, any>>} props.definitions
 * @param {Record<string, any>} props.schemaOptions
 * @param {string} [props.collectionPrefix]
 * @param {boolean} props.isForced
 * @param {boolean} props.areControlsInstalled
 */
export const planTheSchemaMigration = async ({ db, definitions, schemaOptions, collectionPrefix, isForced, areControlsInstalled }) => {
  const parseServerVersion = parseServerVersionOf()
  const definitionsHash = definitionsHashOf({ definitions, schemaOptions, parseServerVersion })
  const declaredIndexNamesByClass = declaredIndexNamesByClassOf(definitions)
  const unknownPast = { definitionsHash, parseServerVersion, declaredIndexNamesByClass, previouslyDeclaredIndexNamesByClass: null }
  if (!areControlsInstalled) {
    return { isMigrationRun: true, reason: 'migration controls not installed', ...unknownPast }
  }
  if (!db) {
    return { isMigrationRun: true, reason: 'no engine database to read the last migration from', ...unknownPast }
  }
  try {
    const [lastCompletedMigration, databaseSchemaHash] = await Promise.all([
      lastCompletedMigrationStoreOf(db).read(),
      databaseSchemaHashOf({ db, collectionPrefix }),
    ])
    return {
      ...schemaMigrationDecisionOf({ isForced, definitionsHash, databaseSchemaHash, lastCompletedMigration }),
      ...unknownPast,
      databaseSchemaHashBefore: databaseSchemaHash,
      previouslyDeclaredIndexNamesByClass: lastCompletedMigration?.declaredIndexNamesByClass ?? null,
    }
  } catch (error) {
    return { isMigrationRun: true, reason: `last migration unreadable (${error?.message || error})`, ...unknownPast }
  }
}

/**
 * After Parse has started: records a completed migration (never a skipped or a failed one). Never throws.
 * @param {object} props
 * @param {import('mongodb').Db | null} props.db
 * @param {{ definitionsHash: string, databaseSchemaHashBefore?: string | null, parseServerVersion: string | null, declaredIndexNamesByClass?: Record<string, string[]> }} props.plan
 * @param {boolean} props.hasCompleted
 * @param {string} [props.collectionPrefix]
 * @returns {Promise<{ isRecorded: boolean, hasChangedNothing?: boolean, reason?: string }>}
 */
export const recordTheCompletedMigration = async ({ db, plan, hasCompleted, collectionPrefix }) => {
  if (!hasCompleted) {
    return { isRecorded: false, reason: 'the migration did not complete' }
  }
  if (!db) {
    return { isRecorded: false, reason: 'no engine database' }
  }
  try {
    const databaseSchemaHash = await databaseSchemaHashOf({ db, collectionPrefix })
    const hasChangedNothing = Boolean(plan.databaseSchemaHashBefore) && plan.databaseSchemaHashBefore === databaseSchemaHash
    await lastCompletedMigrationStoreOf(db).record({ definitionsHash: plan.definitionsHash, databaseSchemaHash, hasChangedNothing, parseServerVersion: plan.parseServerVersion, declaredIndexNamesByClass: plan.declaredIndexNamesByClass ?? null })
    return { isRecorded: true, hasChangedNothing }
  } catch (error) {
    return { isRecorded: false, reason: error?.message || String(error) }
  }
}
