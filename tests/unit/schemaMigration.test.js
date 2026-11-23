import { jest } from '@jest/globals'
import {
  controlTheMigrationOf,
  definitionsHashOf,
  installTheMigrationControls,
  planTheSchemaMigration,
  recordTheCompletedMigration,
  schemaMigrationDecisionOf,
} from '../../src/schemaMigration/index.js'
import { engineOptionsFrom } from '../../src/options/index.js'

// Parse's schema migration skipped at boot when nothing changed (framework audit 2026-11-23, F4): the decision, the
// hashes, and the hooks on Parse's DefinedSchemas. The real boots are in tests/integration/schemaMigration.test.js.

const DEFINITIONS = [
  { className: 'Book', fields: { title: { type: 'String' } }, indexes: { _title_: { title: 1 } }, classLevelPermissions: { find: { '*': true } } },
  { className: 'Shelf', fields: { book: { type: 'Pointer', targetClass: 'Book' } }, classLevelPermissions: {} },
]
const OPTIONS = { lockSchemas: true, strict: false, recreateModifiedFields: false, deleteExtraFields: false }

describe('the schema migration decision', () => {
  const definitionsHash = 'd1'
  const databaseSchemaHash = 's1'
  const lastCompletedMigration = { definitionsHash, databaseSchemaHash, hasChangedNothing: true }

  test('skips only when the last completed run changed nothing and both hashes are the same', () => {
    expect(schemaMigrationDecisionOf({ isForced: false, definitionsHash, databaseSchemaHash, lastCompletedMigration }))
      .toEqual({ isMigrationRun: false, reason: 'definitions and database schema unchanged since the last migration' })
  })

  test.each([
    ['forced', { isForced: true }, 'forced'],
    ['no record (a new database, a restore without it)', { lastCompletedMigration: null }, 'no completed migration recorded'],
    ['changed definitions', { definitionsHash: 'd2' }, 'definitions changed'],
    ['a changed _SCHEMA', { databaseSchemaHash: 's2' }, 'database schema changed since the last migration'],
    ['an unreadable _SCHEMA', { databaseSchemaHash: null }, 'database schema changed since the last migration'],
    ['a last run that changed something', { lastCompletedMigration: { ...lastCompletedMigration, hasChangedNothing: false } }, 'the last migration changed the database schema: a run that changes nothing comes first'],
    ['a record from before hasChangedNothing', { lastCompletedMigration: { definitionsHash, databaseSchemaHash } }, 'the last migration changed the database schema: a run that changes nothing comes first'],
  ])('runs on %s', (_name, change, reason) => {
    expect(schemaMigrationDecisionOf({ isForced: false, definitionsHash, databaseSchemaHash, lastCompletedMigration, ...change }))
      .toEqual({ isMigrationRun: true, reason })
  })
})

describe('the definitions hash', () => {
  const hashOf = (props) => definitionsHashOf({ definitions: DEFINITIONS, schemaOptions: OPTIONS, parseServerVersion: '8.2.2', ...props })

  test('does not depend on the order of classes or of keys', () => {
    const reordered = [...DEFINITIONS].reverse().map((definition) => Object.fromEntries(Object.entries(definition).reverse()))
    expect(hashOf({ definitions: reordered })).toBe(hashOf())
  })

  test.each([
    ['a field', [{ ...DEFINITIONS[0], fields: { ...DEFINITIONS[0].fields, author: { type: 'String' } } }, DEFINITIONS[1]]],
    ['a field type', [{ ...DEFINITIONS[0], fields: { title: { type: 'Number' } } }, DEFINITIONS[1]]],
    ['a pointer target', [DEFINITIONS[0], { ...DEFINITIONS[1], fields: { book: { type: 'Pointer', targetClass: 'Shelf' } } }]],
    ['an index', [{ ...DEFINITIONS[0], indexes: { _title_: { title: -1 } } }, DEFINITIONS[1]]],
    ['a class-level permission', [{ ...DEFINITIONS[0], classLevelPermissions: { find: { 'role:admin': true } } }, DEFINITIONS[1]]],
    ['a class', [...DEFINITIONS, { className: 'Lamp', fields: {} }]],
  ])('changes with %s', (_name, definitions) => {
    expect(hashOf({ definitions })).not.toBe(hashOf())
  })

  test('changes with Parse Server\'s version and with the migration options', () => {
    expect(hashOf({ parseServerVersion: '8.3.0' })).not.toBe(hashOf())
    expect(hashOf({ schemaOptions: { ...OPTIONS, deleteExtraFields: true } })).not.toBe(hashOf())
  })
})

describe('the hooks on DefinedSchemas', () => {
  const fakeDefinedSchemasClass = ({ doesFail }) => {
    const calls = []
    class DefinedSchemas {
      constructor(schemaOptions) {
        this.schemaOptions = schemaOptions
      }

      async execute() {
        calls.push('execute')
        try {
          await this.executeMigrations()
        } catch {
          calls.push('failure logged, boot goes on')
        }
      }

      async executeMigrations() {
        calls.push('saveOrUpdate every class')
        if (doesFail) {
          throw new Error('a class failed')
        }
        await this.enforceCLPForNonProvidedClass()
      }

      async enforceCLPForNonProvidedClass() {
        calls.push('enforce CLP')
      }
    }
    return { DefinedSchemas, calls }
  }

  test('a skipped run does nothing; a run that reaches its last step says so; a failed run says nothing', async () => {
    const skipped = fakeDefinedSchemasClass({ doesFail: false })
    expect(installTheMigrationControls(skipped.DefinedSchemas)).toEqual({ isInstalled: true })
    const skippedOptions = {}
    const onSkipped = jest.fn()
    controlTheMigrationOf(skippedOptions, { isSkipped: true, onSkipped })
    await new skipped.DefinedSchemas(skippedOptions).execute()
    expect(skipped.calls).toEqual([])
    expect(onSkipped).toHaveBeenCalledTimes(1)

    const completed = fakeDefinedSchemasClass({ doesFail: false })
    installTheMigrationControls(completed.DefinedSchemas)
    const completedOptions = {}
    const onCompleted = jest.fn()
    controlTheMigrationOf(completedOptions, { isSkipped: false, onCompleted })
    await new completed.DefinedSchemas(completedOptions).execute()
    expect(completed.calls).toEqual(['execute', 'saveOrUpdate every class', 'enforce CLP'])
    expect(onCompleted).toHaveBeenCalledTimes(1)

    const failed = fakeDefinedSchemasClass({ doesFail: true })
    installTheMigrationControls(failed.DefinedSchemas)
    const failedOptions = {}
    const onFailedCompleted = jest.fn()
    controlTheMigrationOf(failedOptions, { isSkipped: false, onCompleted: onFailedCompleted })
    await new failed.DefinedSchemas(failedOptions).execute()
    expect(failed.calls).toEqual(['execute', 'saveOrUpdate every class', 'failure logged, boot goes on'])
    expect(onFailedCompleted).not.toHaveBeenCalled()

    // A run nobody controls (another ParseServer in the process) runs as Parse wrote it.
    const uncontrolled = fakeDefinedSchemasClass({ doesFail: false })
    installTheMigrationControls(uncontrolled.DefinedSchemas)
    await new uncontrolled.DefinedSchemas({}).execute()
    expect(uncontrolled.calls).toEqual(['execute', 'saveOrUpdate every class', 'enforce CLP'])
  })

  test('installs on Parse Server\'s own DefinedSchemas, once', () => {
    expect(installTheMigrationControls()).toEqual({ isInstalled: true })
    expect(installTheMigrationControls()).toEqual({ isInstalled: true })
  })

  test('a class without the expected methods (another Parse) is left alone, and then the migration always runs', async () => {
    expect(installTheMigrationControls(class Other {})).toEqual({ isInstalled: false, reason: 'DefinedSchemas has no execute/enforceCLPForNonProvidedClass' })
    const plan = await planTheSchemaMigration({ db: null, definitions: DEFINITIONS, schemaOptions: OPTIONS, isForced: false, areControlsInstalled: false })
    expect(plan).toMatchObject({ isMigrationRun: true, reason: 'migration controls not installed' })
  })
})

describe('planning and recording never fail the boot', () => {
  const failingDb = {
    collection: () => ({
      findOne: async () => { throw new Error('not reachable') },
      find: () => ({ sort: () => ({ toArray: async () => { throw new Error('not reachable') } }) }),
      updateOne: async () => { throw new Error('not reachable') },
    }),
  }

  test('an unreadable state runs the migration, an unwritable one records nothing', async () => {
    const plan = await planTheSchemaMigration({ db: failingDb, definitions: DEFINITIONS, schemaOptions: OPTIONS, isForced: false, areControlsInstalled: true })
    expect(plan).toMatchObject({ isMigrationRun: true, reason: 'last migration unreadable (not reachable)' })
    expect(await recordTheCompletedMigration({ db: failingDb, plan, hasCompleted: true })).toEqual({ isRecorded: false, reason: 'not reachable' })
    expect(await recordTheCompletedMigration({ db: failingDb, plan, hasCompleted: false })).toEqual({ isRecorded: false, reason: 'the migration did not complete' })
    expect(await planTheSchemaMigration({ db: null, definitions: DEFINITIONS, schemaOptions: OPTIONS, isForced: false, areControlsInstalled: true }))
      .toMatchObject({ isMigrationRun: true, reason: 'no engine database to read the last migration from' })
  })
})

describe('the option', () => {
  test('isSchemaMigrationForced is off by default, set by the app, and SERVABLE_FORCE_SCHEMA_MIGRATION wins', () => {
    expect(engineOptionsFrom({ env: {} }).isSchemaMigrationForced).toBe(false)
    expect(engineOptionsFrom({ engineConfiguration: { isSchemaMigrationForced: true }, env: {} }).isSchemaMigrationForced).toBe(true)
    expect(engineOptionsFrom({ engineConfiguration: { isSchemaMigrationForced: true }, env: { SERVABLE_FORCE_SCHEMA_MIGRATION: 'off' } }).isSchemaMigrationForced).toBe(false)
    expect(engineOptionsFrom({ env: { SERVABLE_FORCE_SCHEMA_MIGRATION: '1' } }).isSchemaMigrationForced).toBe(true)
  })
})
