import { jest } from '@jest/globals'
import { MongoClient } from 'mongodb'
// @ts-ignore - parse-server ships no declarations for its compiled lib/ files.
import MongoStorageAdapterModule from 'parse-server/lib/Adapters/Storage/Mongo/MongoStorageAdapter.js'
import createIndexes from '../../src/indexes/index.js'

// Against a real MongoDB, on purpose: what is verified is MongoDB's own answer to an index made again, to an index
// that clashes, to duplicates under a unique index, and that an index Parse's adapter made before the move is found
// identical (so moving backend/main's index makers to declarations changes nothing in a database).
//
// Uses SERVABLE_TEST_DATABASE_URI's server, defaulting to a scratch MongoDB on 27018 (see stateStore.test.js), in a
// throwaway database dropped before each test and at the end; skips (not fails) when none is reachable.
const TEST_SERVER_URI = process.env.SERVABLE_TEST_DATABASE_URI
  || 'mongodb://root:DATABASE_PASSWORD_TO_CHANGE@127.0.0.1:27018/?authSource=admin'
const DB = 'servable-indexes-test'
const databaseUri = (() => {
  const url = new URL(TEST_SERVER_URI)
  url.pathname = `/${DB}`
  return url.toString()
})()

const MongoStorageAdapter = MongoStorageAdapterModule.MongoStorageAdapter ?? MongoStorageAdapterModule.default ?? MongoStorageAdapterModule

let client = null
try {
  client = await new MongoClient(TEST_SERVER_URI, { serverSelectionTimeoutMS: 2000 }).connect()
} catch {
  client = null
}

const describeIfMongo = client ? describe : describe.skip

describeIfMongo('ensured indexes (real MongoDB)', () => {
  let db
  let adapter
  let indexes

  const indexesOf = async (collectionName) => (await db.collection(collectionName).indexes()).filter(({ name }) => name !== '_id_')
  const declaredClasses = [
    { className: 'UniqueClaim', fields: { key: { type: 'String' } } },
    { className: 'PublishableObjectIn', fields: { repoId: { type: 'String' }, repoType: { type: 'String' } } },
    { className: 'PodcastEpisode', fields: { audio: { type: 'Pointer', targetClass: 'AudioRaw' } } },
  ]

  beforeAll(async () => {
    db = client.db(DB)
    adapter = new MongoStorageAdapter({ uri: databaseUri })
    indexes = createIndexes({ resolveAdapter: async () => adapter, declaredClasses: () => declaredClasses })
  })

  beforeEach(async () => {
    await db.dropDatabase()
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => jest.restoreAllMocks())

  afterAll(async () => {
    await db.dropDatabase()
    await adapter.handleShutdown()
    await client.close()
  })

  test('a unique index Parse\'s adapter made before is found identical: nothing new, nothing refused', async () => {
    await adapter.ensureUniqueness('UniqueClaim', { fields: { key: { type: 'String' } } }, ['key'])
    const before = await indexesOf('UniqueClaim')
    expect(await indexes.ensure({ className: 'UniqueClaim', name: 'key_1', keys: { key: 1 }, isUnique: true })).toEqual({ isEnsured: true, className: 'UniqueClaim', name: 'key_1' })
    expect(await indexesOf('UniqueClaim')).toEqual(before)
    expect(before).toEqual([expect.objectContaining({ name: 'key_1', key: { key: 1 }, unique: true, sparse: true })])
  })

  test('a named index Parse\'s adapter made before (the repo cursor, with objectId) is found identical', async () => {
    await adapter.ensureIndex('PublishableObjectIn', { fields: { repoId: { type: 'String' }, repoType: { type: 'String' }, objectId: { type: 'String' } } }, ['repoId', 'repoType', 'objectId'], '_repo_cursor_')
    const before = await indexesOf('PublishableObjectIn')
    expect((await indexes.ensure({ className: 'PublishableObjectIn', name: '_repo_cursor_', keys: { repoId: 1, repoType: 1, objectId: 1 } })).isEnsured).toBe(true)
    expect(await indexesOf('PublishableObjectIn')).toEqual(before)
    expect(before).toEqual([expect.objectContaining({ name: '_repo_cursor_', key: { repoId: 1, repoType: 1, _id: 1 }, sparse: true })])
  })

  test('is made once, whatever the number of boots, on a pointer, a dotted path and with a partial filter', async () => {
    for (let boot = 0; boot < 3; boot++) {
      const answer = await indexes.ensureTheDeclared({
        classes: [
          { className: 'PodcastEpisode', ensuredIndexes: { _audio_: { keys: { audio: 1 } } } },
          { className: 'Snippet', ensuredIndexes: { _keptMediaId_: { keys: { 'content.media.id': 1 } } } },
          { className: 'Ticket', ensuredIndexes: { _live_code_: { keys: { code: 1 }, isUnique: true, partialFilter: { status: { $eq: 'live' } } } } },
        ],
      })
      expect(answer.failed).toEqual([])
    }
    expect(await indexesOf('PodcastEpisode')).toEqual([expect.objectContaining({ name: '_audio_', key: { _p_audio: 1 }, sparse: true })])
    expect(await indexesOf('Snippet')).toEqual([expect.objectContaining({ name: '_keptMediaId_', key: { 'content.media.id': 1 } })])
    const [partial] = await indexesOf('Ticket')
    expect(partial).toEqual(expect.objectContaining({ name: '_live_code_', unique: true, partialFilterExpression: { status: { $eq: 'live' } } }))
    expect(partial.sparse).toBeUndefined()
    // The partial unique index refuses a second live code, and lets a retired one be.
    await db.collection('Ticket').insertMany([{ code: 'a', status: 'live' }, { code: 'a', status: 'retired' }])
    await expect(db.collection('Ticket').insertOne({ code: 'a', status: 'live' })).rejects.toThrow(/E11000/)
  })

  test('a clash or duplicates are not made, said why, and never stop the next one', async () => {
    await db.collection('UniqueClaim').insertMany([{ key: 'same' }, { key: 'same' }])
    await indexes.ensure({ className: 'PodcastEpisode', name: '_audio_', keys: { audio: 1 } })
    const answer = await indexes.ensureTheDeclared({
      classes: [
        { className: 'UniqueClaim', ensuredIndexes: { key_1: { keys: { key: 1 }, isUnique: true } } },
        { className: 'PodcastEpisode', ensuredIndexes: { _audio_: { keys: { audio: -1 } }, _audio_again_: { keys: { audio: 1 } } } },
        { className: 'Snippet', ensuredIndexes: { _keptMediaId_: { keys: { 'content.media.id': 1 } } } },
      ],
    })
    expect(answer.ensured).toEqual(['Snippet._keptMediaId_'])
    expect(answer.failed).toEqual([
      { index: 'UniqueClaim.key_1', reason: expect.stringMatching(/holds duplicates/) },
      { index: 'PodcastEpisode._audio_', reason: expect.stringMatching(/name is already taken|already exists/) },
      { index: 'PodcastEpisode._audio_again_', reason: expect.stringMatching(/already exists under another name/) },
    ])
    expect(await indexesOf('UniqueClaim')).toEqual([])
  })
})
