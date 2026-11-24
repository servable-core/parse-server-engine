import { createRequire } from 'module'
import {
  controlTheMigrationOf,
  declaredIndexNamesByClassOf,
  installTheMigrationControls,
  isIndexProtectedFromTheMigration,
  migrationControlsOf,
  planTheSchemaMigration,
  recordTheCompletedMigration,
} from '../../src/schemaMigration/index.js'

// Parse's schema migration and the indexes the engine makes itself (owner's Q1470 a, 2026-11-24).
//
// backend/main never skipped the migration: every boot logged "the last migration changed the database schema". The
// indexes the engine makes after boot (a schema's `ensuredIndexes`, its own `_Session._session_token_1`, and those
// `Servable.App.Indexes.ensure` makes at run time) are not in the definitions Parse receives, so Parse's DefinedSchemas
// deletes them, and it does so every other boot only:
//
//   - Parse's start copies the real MongoDB indexes into `_SCHEMA` (`performInitialization` →
//     `updateSchemaWithIndexes`) AFTER it has loaded its schema cache, and DefinedSchemas compares the definitions with
//     that cache, so it sees `_SCHEMA` as the boot found it;
//   - a boot that finds `key_1` listed in `_SCHEMA` deletes it: Parse drops the real index and writes `_SCHEMA` without
//     it; the engine makes it again after boot;
//   - the next boot finds `_SCHEMA` without it, deletes nothing, and Parse writes back the real list, `key_1` included.
//
// So `_SCHEMA` flips between two states, no run ever "changes nothing", and on every other boot a unique index is
// dropped and rebuilt. These tests run Parse's own `DefinedSchemas.prototype.updateSchema` against a model of `_SCHEMA`
// and of the real indexes that does what Parse's MongoDB adapter does, through the engine's own plan and record.

const requireFromHere = createRequire(import.meta.url)
const { DefinedSchemas } = requireFromHere('parse-server/lib/SchemaMigrations/DefinedSchemas.js')

const OPTIONS = { lockSchemas: true, strict: false, recreateModifiedFields: false, deleteExtraFields: false }
const CLP = { find: { '*': true }, addField: {} }

// What Parse receives: `ensuredIndexes` stripped (launch's parseDefinitionOf).
const DEFINITIONS = [
  { className: 'UniqueClaim', classLevelPermissions: CLP, indexes: { _id_: { _id: 1 } } },
  { className: 'PublishableObjectIn', classLevelPermissions: CLP, indexes: { _id_: { _id: 1 }, _repo_: { repoId: 1 } } },
  { className: '_Session', classLevelPermissions: CLP, indexes: { _id_: { _id: 1 } } },
]

// The indexes the engine makes after boot: an `ensuredIndexes` of the schema, its own on `_Session`, and one made at
// run time through `Servable.App.Indexes.ensure`.
const ENGINE_MADE_INDEXES = {
  UniqueClaim: { key_1: { key: 1 } },
  PublishableObjectIn: { _repo_cursor_: { repoId: 1, _id: 1 }, _targetPointerArticle_: { _p_targetArticle: 1 } },
  _Session: { _session_token_1: { _session_token: 1 } },
}

const clone = (value) => JSON.parse(JSON.stringify(value))

/**
 * A database as backend/main's was: every index there, `_SCHEMA` listing them all (Parse's start copied them), and no
 * record of a completed migration yet.
 */
const databaseOf = ({ definitions = DEFINITIONS } = {}) => {
  const realIndexes = {}
  for (const definition of definitions) {
    realIndexes[definition.className] = { ...definition.indexes, ...(ENGINE_MADE_INDEXES[definition.className] || {}) }
  }
  const schema = {}
  for (const definition of definitions) {
    schema[definition.className] = { _id: definition.className, _metadata: { indexes: clone(realIndexes[definition.className]), class_permissions: clone(CLP) } }
  }
  return { realIndexes, schema, record: null, droppedIndexes: [] }
}

// The engine database as the engine reads it: `_SCHEMA` and its state collection.
const engineDatabaseOf = (database) => ({
  collection: (name) => (name === '_SCHEMA'
    ? { find: () => ({ sort: () => ({ toArray: async () => Object.keys(database.schema).sort().map((className) => clone(database.schema[className])) }) }) }
    : {
        findOne: async () => (database.record ? clone(database.record) : null),
        updateOne: async (_query, { $set }) => { database.record = clone($set) },
      }),
})

// One run of Parse's DefinedSchemas over the classes, with its writes done as Parse's MongoDB adapter does them.
const runTheMigration = async ({ database, definitions, cachedSchema, controls }) => {
  const schemaOptions = { ...OPTIONS, definitions }
  controlTheMigrationOf(schemaOptions, controls)
  const migration = Object.create(DefinedSchemas.prototype)
  migration.schemaOptions = schemaOptions
  migration.localSchemas = definitions
  // SchemasRouter.internalUpdateSchema: loads `_SCHEMA` afresh, then SchemaController.updateClass →
  // MongoStorageAdapter.setIndexesWithSchemaFormat (drops a deleted index, makes an added one, writes the list).
  migration.updateSchemaToDB = async (parseSchema) => {
    const className = parseSchema.className
    const existingIndexes = clone(database.schema[className]._metadata.indexes)
    for (const [indexName, index] of Object.entries(parseSchema._indexes || {})) {
      if (index.__op === 'Delete') {
        if (!existingIndexes[indexName]) {
          throw new Error(`Index ${indexName} does not exist, cannot delete.`)
        }
        delete existingIndexes[indexName]
        delete database.realIndexes[className][indexName]
        database.droppedIndexes.push(`${className}.${indexName}`)
      } else {
        existingIndexes[indexName] = index
        database.realIndexes[className][indexName] = index
      }
    }
    database.schema[className]._metadata.indexes = existingIndexes
    database.schema[className]._metadata.class_permissions = parseSchema._clp
    parseSchema._fields = {}
    parseSchema._indexes = {}
  }
  for (const definition of definitions) {
    const cached = cachedSchema[definition.className]
    await migration.updateSchema(definition, { className: definition.className, fields: {}, indexes: cached._metadata.indexes, classLevelPermissions: cached._metadata.class_permissions })
  }
  controls.onCompleted?.()
}

/**
 * One boot of the engine, in the order Parse Server's start runs: the engine's plan, Parse's schema cache loaded,
 * `updateSchemaWithIndexes`, DefinedSchemas (unless skipped), the engine's record, then the engine's indexes.
 * @param {{ isIndexProtectionWired: boolean }} wiring - false: the controls launch passed before the fix.
 */
const bootOnce = async ({ database, definitions = DEFINITIONS, isIndexProtectionWired }) => {
  const db = engineDatabaseOf(database)
  const plan = await planTheSchemaMigration({ db, definitions, schemaOptions: OPTIONS, isForced: false, areControlsInstalled: true })
  let hasCompleted = false
  const onCompleted = () => { hasCompleted = true }
  const controls = isIndexProtectionWired
    ? migrationControlsOf({ plan, onCompleted })
    : { isSkipped: !plan.isMigrationRun, onCompleted }

  const cachedSchema = clone(database.schema)
  for (const className of Object.keys(database.schema)) {
    database.schema[className]._metadata.indexes = clone(database.realIndexes[className])
  }
  if (!controls.isSkipped) {
    await runTheMigration({ database, definitions, cachedSchema, controls })
  }
  const recording = plan.isMigrationRun ? await recordTheCompletedMigration({ db, plan, hasCompleted }) : null
  for (const [className, indexes] of Object.entries(ENGINE_MADE_INDEXES)) {
    if (database.realIndexes[className]) {
      Object.assign(database.realIndexes[className], indexes)
    }
  }
  return plan.isMigrationRun ? (recording.hasChangedNothing ? 'ran, changed nothing' : 'ran, changed _SCHEMA') : 'skipped'
}

beforeAll(() => {
  expect(installTheMigrationControls()).toEqual({ isInstalled: true })
})

describe('the boots of backend/main, reproduced', () => {
  test('before the fix: _SCHEMA flips every boot, the migration never skips, and the engine\'s indexes are dropped every other boot', async () => {
    const database = databaseOf()
    const boots = []
    for (let boot = 0; boot < 4; boot += 1) {
      boots.push(await bootOnce({ database, isIndexProtectionWired: false }))
    }
    expect(boots).toEqual(['ran, changed _SCHEMA', 'ran, changed _SCHEMA', 'ran, changed _SCHEMA', 'ran, changed _SCHEMA'])
    expect(database.droppedIndexes).toEqual(expect.arrayContaining(['UniqueClaim.key_1', 'PublishableObjectIn._repo_cursor_', 'PublishableObjectIn._targetPointerArticle_', '_Session._session_token_1']))
    expect(database.droppedIndexes.filter((index) => index === 'UniqueClaim.key_1')).toHaveLength(2)
  })

  test('with the engine\'s controls: no index of the engine is dropped, the second run changes nothing, the third boot skips', async () => {
    const database = databaseOf()
    const boots = []
    for (let boot = 0; boot < 4; boot += 1) {
      boots.push(await bootOnce({ database, isIndexProtectionWired: true }))
    }
    expect(boots).toEqual(['ran, changed nothing', 'skipped', 'skipped', 'skipped'])
    expect(database.droppedIndexes).toEqual([])
  })

  test('from the state backend/main is in now (_SCHEMA one step of the flip behind the real indexes), it converges too', async () => {
    const database = databaseOf()
    // The last boot before the fix: `_SCHEMA` without the indexes that boot dropped, the engine made them again after.
    await bootOnce({ database, isIndexProtectionWired: false })
    expect(database.schema.UniqueClaim._metadata.indexes).not.toHaveProperty('key_1')
    expect(database.realIndexes.UniqueClaim).toHaveProperty('key_1')

    const boots = []
    for (let boot = 0; boot < 4; boot += 1) {
      boots.push(await bootOnce({ database, isIndexProtectionWired: true }))
    }
    expect(boots).toEqual(['ran, changed _SCHEMA', 'ran, changed nothing', 'skipped', 'skipped'])
    expect(database.droppedIndexes.filter((index) => index === 'UniqueClaim.key_1')).toHaveLength(1)
    expect(database.schema.UniqueClaim._metadata.indexes).toHaveProperty('key_1')
  })

  test('Parse still drops an index its definitions declared at the last completed run and no longer declare', async () => {
    const database = databaseOf()
    await bootOnce({ database, isIndexProtectionWired: true })
    const withoutRepo = DEFINITIONS.map((definition) => (definition.className === 'PublishableObjectIn'
      ? { ...definition, indexes: { _id_: { _id: 1 } } }
      : definition))
    expect(await bootOnce({ database, definitions: withoutRepo, isIndexProtectionWired: true })).toBe('ran, changed _SCHEMA')
    expect(database.droppedIndexes).toEqual(['PublishableObjectIn._repo_'])
    expect(database.realIndexes.PublishableObjectIn).toHaveProperty('_repo_cursor_')
    expect(await bootOnce({ database, definitions: withoutRepo, isIndexProtectionWired: true })).toBe('ran, changed nothing')
    expect(await bootOnce({ database, definitions: withoutRepo, isIndexProtectionWired: true })).toBe('skipped')
  })

  test('a declared index whose keys changed is still remade by Parse', async () => {
    const database = databaseOf()
    await bootOnce({ database, isIndexProtectionWired: true })
    const changedRepo = DEFINITIONS.map((definition) => (definition.className === 'PublishableObjectIn'
      ? { ...definition, indexes: { _id_: { _id: 1 }, _repo_: { repoId: -1 } } }
      : definition))
    await bootOnce({ database, definitions: changedRepo, isIndexProtectionWired: true })
    expect(database.droppedIndexes).toEqual(['PublishableObjectIn._repo_'])
    expect(database.realIndexes.PublishableObjectIn._repo_).toEqual({ repoId: -1 })
  })
})

describe('which indexes Parse\'s migration may delete', () => {
  const declaredIndexNamesByClass = declaredIndexNamesByClassOf(DEFINITIONS)

  test('the names each class declares to Parse, sorted', () => {
    expect(declaredIndexNamesByClass).toEqual({ UniqueClaim: ['_id_'], PublishableObjectIn: ['_id_', '_repo_'], _Session: ['_id_'] })
    expect(declaredIndexNamesByClassOf([{ className: 'A' }, null, { indexes: { x: { x: 1 } } }])).toEqual({ A: [] })
  })

  test.each([
    ['an index Parse does not declare and never did (the engine\'s, a hand-made one)', 'UniqueClaim', 'key_1', { UniqueClaim: ['_id_'] }, true],
    ['the same, with no record of what Parse declared before', 'UniqueClaim', 'key_1', null, true],
    ['an index Parse declared at the last completed run and no longer declares', 'PublishableObjectIn', '_old_', { PublishableObjectIn: ['_old_'] }, false],
    ['an index Parse declares (its keys may have changed)', 'PublishableObjectIn', '_repo_', null, false],
    ['a class name that is a property of every object', 'constructor', 'key_1', { constructor: 'not a list' }, true],
  ])('%s: protected = %s', (_name, className, indexName, previouslyDeclaredIndexNamesByClass, isProtected) => {
    expect(isIndexProtectedFromTheMigration({ className, indexName, declaredIndexNamesByClass, previouslyDeclaredIndexNamesByClass })).toBe(isProtected)
  })

  test('a run nobody controls keeps Parse\'s own protection only', () => {
    const migration = Object.create(DefinedSchemas.prototype)
    migration.schemaOptions = { ...OPTIONS }
    expect(migration.isProtectedIndex('UniqueClaim', '_id_')).toBe(true)
    expect(migration.isProtectedIndex('UniqueClaim', 'key_1')).toBe(false)
  })
})
