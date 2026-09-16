import { MongoClient } from 'mongodb'
import { createStateStoreForDb, ensureIndexes, COLLECTIONS } from '../../src/stateStore/index.js'

// Integration test against a real MongoDB, on purpose: what is being verified is MongoDB's own
// behavior - the atomic `$max` pipeline update under interleaved writers, and unique-index upsert
// races - which a mock can only pretend to check. Ported from @servable/server's former
// tests/integration/recordAppliedArtifact.test.js (utilless moved the implementation here).
//
// Uses SERVABLE_TEST_DATABASE_URI, defaulting to a scratch MongoDB on 27018. Never spins up
// containers itself and never calls launch(). Works in a throwaway database dropped before each
// test and at the end, and skips (not fails) when no MongoDB is reachable.
const TEST_URI = process.env.SERVABLE_TEST_DATABASE_URI
  || 'mongodb://root:DATABASE_PASSWORD_TO_CHANGE@127.0.0.1:27018/?authSource=admin'
const DB = 'servable-state-store-test'

let client = null
try {
  client = await new MongoClient(TEST_URI, { serverSelectionTimeoutMS: 2000 }).connect()
} catch (error) {
  client = null
}

const describeIfMongo = client ? describe : describe.skip

describeIfMongo('parse-server engine state store (real MongoDB)', () => {
  let db
  let store

  beforeAll(() => {
    db = client.db(DB)
  })

  beforeEach(async () => {
    await db.dropDatabase()
    await ensureIndexes(db)
    store = createStateStoreForDb(db)
  })

  afterAll(async () => {
    await db.dropDatabase()
    await client.close()
  })

  describe('schemaState', () => {
    test('first-ever write for a key upserts, and get returns it without _id', async () => {
      const doc = await store.schemaState.recordApplied({ key: 'k', artifactHash: 'h1', compatibilityFloor: 0 })

      expect(doc).toMatchObject({ key: 'k', artifactHash: 'h1', compatibilityFloor: 0 })
      const read = await store.schemaState.get({ key: 'k' })
      expect(read).toMatchObject({ key: 'k', artifactHash: 'h1', compatibilityFloor: 0 })
      expect(read._id).toBeUndefined()
    })

    test('no record yet: get resolves null', async () => {
      await expect(store.schemaState.get({ key: 'missing' })).resolves.toBeNull()
    })

    test('cross-build race never lets a lower-floor pod\'s write regress an already-raised floor', async () => {
      // Pod A (a `schema contract` deploy, floor 1) and pod B (an old pod on floor 0) both passed
      // their compatibility check before either wrote; A's write lands, then B's. This exact
      // interleaving regressed the floor from 1 to 0 under the old read-then-write implementation.
      await store.schemaState.recordApplied({ key: 'k', artifactHash: 'hA', compatibilityFloor: 1 })
      await store.schemaState.recordApplied({ key: 'k', artifactHash: 'hB', compatibilityFloor: 0 })

      expect((await store.schemaState.get({ key: 'k' })).compatibilityFloor).toBe(1)
    })

    test('floor still rises when the higher-floor write lands second', async () => {
      await store.schemaState.recordApplied({ key: 'k', artifactHash: 'hOld', compatibilityFloor: 0 })
      await store.schemaState.recordApplied({ key: 'k', artifactHash: 'hNew', compatibilityFloor: 1 })

      expect(await store.schemaState.get({ key: 'k' })).toMatchObject({ artifactHash: 'hNew', compatibilityFloor: 1 })
    })

    test('many pods booting at once on a brand-new key: one record, highest floor wins', async () => {
      await Promise.all(Array.from({ length: 20 }, (_, i) => store.schemaState.recordApplied({
        key: 'k', artifactHash: `h${i}`, compatibilityFloor: i % 2,
      })))

      expect(await db.collection(COLLECTIONS.schema).countDocuments({ key: 'k' })).toBe(1)
      expect((await store.schemaState.get({ key: 'k' })).compatibilityFloor).toBe(1)
    })

    test('an artifact hash that looks like a field path is stored literally', async () => {
      await store.schemaState.recordApplied({ key: 'k', artifactHash: '$compatibilityFloor', compatibilityFloor: 0 })

      expect((await store.schemaState.get({ key: 'k' })).artifactHash).toBe('$compatibilityFloor')
    })
  })

  describe('bootState', () => {
    const key = { kind: 'seed', type: 'class', entityId: 'genre' }

    test('save upserts fields, keeps createdAt across saves, get returns it without _id', async () => {
      const first = await store.bootState.save({ ...key, fields: { state: 1, mode: 'auto' } })
      const second = await store.bootState.save({ ...key, fields: { state: 2, dataSHA: 'S1' } })

      expect(second).toMatchObject({ type: 'class', entityId: 'genre', state: 2, dataSHA: 'S1', mode: 'auto' })
      expect(second.createdAt).toEqual(first.createdAt)
      const read = await store.bootState.get(key)
      expect(read).toMatchObject({ state: 2, dataSHA: 'S1' })
      expect(read._id).toBeUndefined()
    })

    test('concurrent first saves of the same record end as one document', async () => {
      await Promise.all(Array.from({ length: 10 }, () => store.bootState.save({ ...key, fields: { state: 1 } })))

      expect(await db.collection(COLLECTIONS.seed).countDocuments({ type: 'class', entityId: 'genre' })).toBe(1)
    })

    test('seed and config records are kept apart', async () => {
      await store.bootState.save({ ...key, fields: { dataSHA: 'seed' } })
      await store.bootState.save({ ...key, kind: 'config', fields: { dataSHA: 'config' } })

      expect((await store.bootState.get(key)).dataSHA).toBe('seed')
      expect((await store.bootState.get({ ...key, kind: 'config' })).dataSHA).toBe('config')
    })

    test('an unknown kind is rejected rather than written somewhere unexpected', async () => {
      await expect(store.bootState.get({ ...key, kind: 'schema' })).rejects.toThrow(/Unknown boot state kind/)
      await expect(store.bootState.save({ ...key, kind: 'nope', fields: {} })).rejects.toThrow(/Unknown boot state kind/)
    })
  })
})
