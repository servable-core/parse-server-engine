import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { MongoClient } from 'mongodb'
import { COLLECTIONS } from '../../src/stateStore/collections.js'
import { databaseSchemaHashOf } from '../../src/schemaMigration/index.js'

// Parse's schema migration skipped at boot when nothing changed (framework audit 2026-11-23, F4), against a real
// MongoDB and real boots of the engine's launch, each in a process of its own (fixtures/bootOnce.mjs):
//   - a first boot runs the migration and records it; the next, unchanged, skips it and writes nothing to `_SCHEMA`;
//   - changed definitions, a `_SCHEMA` changed by hand, no record, or a forced run: the migration runs;
//   - on backend/main's real definitions (its committed servable.schema.json, when the workspace has it), a migration
//     run again on what the previous one left changes nothing: the fixed point the skip rests on.
//
// Same scratch MongoDB as the other integration tests (SERVABLE_TEST_DATABASE_URI, defaulting to 127.0.0.1:27018);
// skipped when none is reachable. Its own throwaway databases, dropped before and after.
const TEST_SERVER_URI = process.env.SERVABLE_TEST_DATABASE_URI
  || 'mongodb://root:DATABASE_PASSWORD_TO_CHANGE@127.0.0.1:27018/?authSource=admin'
const databaseURIOf = (name) => {
  const url = new URL(TEST_SERVER_URI)
  url.pathname = `/${name}`
  return url.toString()
}

let client = null
try {
  client = await new MongoClient(TEST_SERVER_URI, { serverSelectionTimeoutMS: 2000 }).connect()
} catch {
  client = null
}
const describeIfMongo = client ? describe : describe.skip

const runFile = promisify(execFile)
const BOOT_ONCE = path.resolve('tests/integration/fixtures/bootOnce.mjs')
const scratchDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'servable-schema-migration-'))

const classesFileOf = (name, classes) => {
  const file = path.join(scratchDirectory, `${name}.json`)
  fs.writeFileSync(file, JSON.stringify(classes))
  return file
}

/**
 * Boots once, and counts what reached `_SCHEMA` meanwhile (MongoDB's profiler).
 * @returns {Promise<{ decision: string, reason: string, isRecorded: boolean, hasChangedNothing?: boolean, parseStartMilliseconds: number, launchMilliseconds: number, schemaUpdates: number, schemaReads: number, schemaModifications: number }>}
 */
const bootOnce = async ({ db, databaseName, classesFile, isForced = false }) => {
  await db.command({ profile: 0 })
  await db.collection('system.profile').drop().catch(() => {})
  await db.command({ profile: 2 })
  const { stdout } = await runFile(process.execPath, [BOOT_ONCE], {
    env: {
      ...process.env,
      SCHEMA_MIGRATION_TEST_DATABASE_URI: databaseURIOf(databaseName),
      SCHEMA_MIGRATION_TEST_CLASSES: classesFile,
      SERVABLE_FORCE_SCHEMA_MIGRATION: isForced ? '1' : '0',
      NODE_ENV: 'test',
    },
    maxBuffer: 64 * 1024 * 1024,
  })
  await db.command({ profile: 0 })
  const line = stdout.split('\n').find((candidate) => candidate.startsWith('BOOT_RESULT '))
  if (!line) {
    throw new Error(`no BOOT_RESULT in:\n${stdout.slice(-2000)}`)
  }
  const ns = `${databaseName}._SCHEMA`
  const schemaUpdates = await db.collection('system.profile').countDocuments({ ns, op: { $in: ['update', 'insert'] } })
  const schemaReads = await db.collection('system.profile').countDocuments({ ns, op: 'query' })
  // Writes that changed a document (Parse's start rewrites every class's `_metadata.indexes` with what MongoDB has,
  // changing nothing once they agree).
  const schemaWrites = await db.collection('system.profile').find({ ns, op: { $in: ['update', 'insert'] } }).toArray()
  const schemaModifications = schemaWrites.reduce((count, write) => count + (write.op === 'insert' ? 1 : (write.nModified || 0) + (write.upsert ? 1 : 0)), 0)
  return { ...JSON.parse(line.slice('BOOT_RESULT '.length)), schemaUpdates, schemaReads, schemaModifications }
}

const CLASSES = [
  { className: 'Book', fields: { title: { type: 'String' }, pages: { type: 'Number' } }, indexes: { _title_: { title: 1 } }, classLevelPermissions: { find: { '*': true }, get: { '*': true } } },
  { className: 'Shelf', fields: { name: { type: 'String' }, book: { type: 'Pointer', targetClass: 'Book' } }, classLevelPermissions: {} },
]

describeIfMongo('the schema migration at boot (real boots, real MongoDB)', () => {
  const databaseName = 'servable-schema-migration-test'
  let db

  beforeAll(async () => {
    db = client.db(databaseName)
    await db.dropDatabase()
  })

  afterAll(async () => {
    await db.command({ profile: 0 }).catch(() => {})
    await db.dropDatabase()
  })

  // Boots until one skips the migration (at most `maximumBoots`): every boot before it ran a migration that changed
  // `_SCHEMA`, the last of them changed nothing. Answers the boots.
  const bootUntilSkipped = async ({ classesFile, maximumBoots = 4 }) => {
    const boots = []
    while (boots.length < maximumBoots) {
      const boot = await bootOnce({ db, databaseName, classesFile })
      boots.push(boot)
      if (boot.decision === 'skipped') {
        return boots
      }
    }
    throw new Error(`no boot skipped the migration: ${JSON.stringify(boots)}`)
  }

  test('runs and records on a first boot, skips once a run changed nothing, runs again on changed definitions, a changed _SCHEMA, a lost record or when forced', async () => {
    const classesFile = classesFileOf('small', CLASSES)

    const first = await bootOnce({ db, databaseName, classesFile })
    expect(first).toMatchObject({ decision: 'ran', reason: 'no completed migration recorded', isRecorded: true, hasChangedNothing: false })
    expect(first.schemaUpdates).toBeGreaterThan(0)
    const untilSkipped = await bootUntilSkipped({ classesFile })
    const skipped = untilSkipped.at(-1)
    const lastRun = untilSkipped.at(-2)
    expect(lastRun).toMatchObject({ decision: 'ran', isRecorded: true, hasChangedNothing: true })
    const record = await db.collection(COLLECTIONS.parseSchema).findOne({ key: 'parse-definitions' })
    expect(record).toMatchObject({ definitionsHash: expect.any(String), databaseSchemaHash: await databaseSchemaHashOf({ db }), hasChangedNothing: true })
    expect(skipped).toMatchObject({ decision: 'skipped', reason: 'definitions and database schema unchanged since the last migration', isRecorded: false })
    // A skipped boot changes nothing in `_SCHEMA` (Parse's own start still rewrites each class's index list, identically).
    expect(skipped.schemaModifications).toBe(0)
    expect(await databaseSchemaHashOf({ db })).toBe(record.databaseSchemaHash)
    expect(await bootOnce({ db, databaseName, classesFile })).toMatchObject({ decision: 'skipped' })

    // Changed definitions: a field more.
    const changedFile = classesFileOf('changed', [{ ...CLASSES[0], fields: { ...CLASSES[0].fields, author: { type: 'String' } } }, CLASSES[1]])
    expect(await bootOnce({ db, databaseName, classesFile: changedFile })).toMatchObject({ decision: 'ran', reason: 'definitions changed', isRecorded: true })
    expect((await db.collection('_SCHEMA').findOne({ _id: 'Book' })).author).toBe('string')
    await bootUntilSkipped({ classesFile: changedFile })

    // `_SCHEMA` changed by hand (a field gone, a CLP opened): the migration runs and puts them back.
    await db.collection('_SCHEMA').updateOne({ _id: 'Book' }, { $unset: { pages: '' }, $set: { '_metadata.class_permissions.addField': { '*': true } } })
    expect(await bootOnce({ db, databaseName, classesFile: changedFile })).toMatchObject({ decision: 'ran', reason: 'database schema changed since the last migration', isRecorded: true })
    const book = await db.collection('_SCHEMA').findOne({ _id: 'Book' })
    expect(book.pages).toBe('number')
    expect(book._metadata.class_permissions.addField).toEqual({})
    await bootUntilSkipped({ classesFile: changedFile })

    // Forced: runs, and on this state changes nothing.
    expect(await bootOnce({ db, databaseName, classesFile: changedFile, isForced: true })).toMatchObject({ decision: 'ran', reason: 'forced', isRecorded: true, hasChangedNothing: true })

    // The record lost (a database restored without it): the migration runs, then is skipped again.
    await db.collection(COLLECTIONS.parseSchema).deleteMany({})
    expect(await bootOnce({ db, databaseName, classesFile: changedFile })).toMatchObject({ decision: 'ran', reason: 'no completed migration recorded', isRecorded: true, hasChangedNothing: true })
    expect(await bootOnce({ db, databaseName, classesFile: changedFile })).toMatchObject({ decision: 'skipped' })
  }, 300000)
})

const appRoot = process.env.SERVABLE_SCHEMA_MIGRATION_APP || path.resolve(process.cwd(), '../../../../backend/main')
const committedArtifactPath = path.join(appRoot, 'servable.schema.json')
const describeIfMongoAndApp = client && fs.existsSync(committedArtifactPath) ? describe : describe.skip

describeIfMongoAndApp(`the schema migration on a real app's definitions (${committedArtifactPath})`, () => {
  const databaseName = 'servable-schema-migration-real-app-test'
  let db

  beforeAll(async () => {
    db = client.db(databaseName)
    await db.dropDatabase()
  })

  afterAll(async () => {
    await db.command({ profile: 0 }).catch(() => {})
    await db.dropDatabase()
    await client.close()
    fs.rmSync(scratchDirectory, { recursive: true, force: true })
  })

  test('the migration reaches a state it no longer changes, and from there the unchanged boot skips it', async () => {
    const { classes } = JSON.parse(fs.readFileSync(committedArtifactPath, 'utf8'))
    const classesFile = classesFileOf('real-app', classes)

    const first = await bootOnce({ db, databaseName, classesFile })
    expect(first).toMatchObject({ decision: 'ran', isRecorded: true })
    const second = await bootOnce({ db, databaseName, classesFile })
    const third = await bootOnce({ db, databaseName, classesFile })
    // The second run completes `_SCHEMA` (Parse's own `_id_` index entries); the third changes nothing, and a forced
    // fourth leaves the very same `_SCHEMA`: the fixed point the skip rests on.
    expect(third).toMatchObject({ decision: 'ran', isRecorded: true, hasChangedNothing: true })
    const atTheFixedPoint = await databaseSchemaHashOf({ db })
    const forced = await bootOnce({ db, databaseName, classesFile, isForced: true })
    expect(forced).toMatchObject({ decision: 'ran', reason: 'forced', isRecorded: true, hasChangedNothing: true })
    expect(await databaseSchemaHashOf({ db })).toBe(atTheFixedPoint)

    const skipped = await bootOnce({ db, databaseName, classesFile })
    expect(skipped).toMatchObject({ decision: 'skipped', isRecorded: false })
    expect(skipped.schemaModifications).toBe(0)
    expect(await databaseSchemaHashOf({ db })).toBe(atTheFixedPoint)

    const line = (boot) => `${Math.round(boot.parseStartMilliseconds)} ms to start Parse, ${boot.schemaUpdates} _SCHEMA writes (${boot.schemaModifications} changing it), ${boot.schemaReads} _SCHEMA reads`
    process.stdout.write(`[schema migration, real app] ${classes.length} classes. First boot: ${line(first)}. Second: ${line(second)}. Unchanged boot with the migration (forced): ${line(forced)}. Skipped: ${line(skipped)}.\n`)
  }, 600000)
})
