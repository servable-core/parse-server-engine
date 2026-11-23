import { jest } from '@jest/globals'
// @ts-ignore - parse-server ships no declarations for its compiled lib/ files.
import MongoStorageAdapterModule from 'parse-server/lib/Adapters/Storage/Mongo/MongoStorageAdapter.js'
// @ts-ignore
import MongoCollectionModule from 'parse-server/lib/Adapters/Storage/Mongo/MongoCollection.js'
// @ts-ignore
import MongoTransform from 'parse-server/lib/Adapters/Storage/Mongo/MongoTransform.js'
import { storageIndexFrom, problemsOfTheDeclaration } from '../../src/indexes/storageIndex.js'
import createIndexes, { startEnsuringTheDeclaredIndexes } from '../../src/indexes/index.js'
import { parseDefinitionOf } from '../../src/launch/index.js'

const MongoStorageAdapter = MongoStorageAdapterModule.MongoStorageAdapter ?? MongoStorageAdapterModule.default ?? MongoStorageAdapterModule
const MongoCollection = MongoCollectionModule.default ?? MongoCollectionModule
const { transformKey } = MongoTransform.default ?? MongoTransform

// A real MongoStorageAdapter whose collections only record what they are asked to create: what Parse's own adapter
// would send to MongoDB, without a MongoDB.
const recordingAdapter = () => {
  const created = []
  const adapter = new MongoStorageAdapter({ uri: 'mongodb://127.0.0.1:1/never-connected' })
  adapter._adaptiveCollection = async (className) => {
    const collection = Object.create(MongoCollection.prototype)
    collection._mongoCollection = { createIndex: async (keys, options) => { created.push({ className, keys, options }); return options?.name } }
    return collection
  }
  return { adapter, created }
}

// MongoDB's own name for an index made without one: `key_1`, `a_1_b_-1`.
const defaultMongoNameOf = (keys) => Object.entries(keys).map(([key, direction]) => `${key}_${direction}`).join('_')

// Every index backend/main made through Parse's adapter before the move (app/lib/**/ensure*.js, rewardable's
// lib/ensureIndexes.js), with the declaration that replaces it. Made from the declaration, each must reach MongoDB
// exactly as Parse's adapter sent it, so the index already in every database is found identical and left alone.
const PARSE_POINTER = (targetClass) => ({ type: 'Pointer', targetClass })
const BEFORE_AND_AFTER = [
  ...[['UniqueClaim', 'key'], ['ReferralLink', 'code'], ['ReferralClick', 'clickId'], ['TicketScan', 'scanId'], ['RewardEvent', 'eventId'], ['RewardAward', 'claimKey'], ['RewardSlot', 'claimKey']]
    .map(([className, field]) => ({
      before: (adapter) => adapter.ensureUniqueness(className, { fields: { [field]: { type: 'String' } } }, [field]),
      className,
      name: `${field}_1`,
      declaration: { keys: { [field]: 1 }, isUnique: true },
      declaredFields: { [field]: { type: 'String' } },
    })),
  {
    before: (adapter) => adapter.ensureIndex('PublishableObjectIn', { fields: { repoId: { type: 'String' }, repoType: { type: 'String' }, objectId: { type: 'String' } } }, ['repoId', 'repoType', 'objectId'], '_repo_cursor_'),
    className: 'PublishableObjectIn',
    name: '_repo_cursor_',
    declaration: { keys: { repoId: 1, repoType: 1, objectId: 1 } },
    declaredFields: { repoId: { type: 'String' }, repoType: { type: 'String' } },
  },
  ...['Article', 'Page', 'Zine', 'PodcastEpisode', 'Snippet', 'Series', 'BookClubSuite', 'PodcastsSuite'].map((targetClassName) => ({
    before: (adapter) => adapter.ensureIndex('PublishableObjectIn', { fields: { [`targetPointer${targetClassName}`]: PARSE_POINTER(targetClassName) } }, [`targetPointer${targetClassName}`], `_targetPointer${targetClassName}_`),
    className: 'PublishableObjectIn',
    name: `_targetPointer${targetClassName}_`,
    declaration: { keys: { [`targetPointer${targetClassName}`]: 1 }, fieldTypes: { [`targetPointer${targetClassName}`]: PARSE_POINTER(targetClassName) } },
    declaredFields: {},
  })),
  ...[['audio', 'AudioRaw'], ['video', 'VideoRaw']].map(([field, targetClass]) => ({
    before: (adapter) => adapter.ensureIndex('PodcastEpisode', { fields: { [field]: PARSE_POINTER(targetClass) } }, [field], `_${field}_`),
    className: 'PodcastEpisode',
    name: `_${field}_`,
    declaration: { keys: { [field]: 1 } },
    declaredFields: { [field]: PARSE_POINTER(targetClass) },
  })),
  ...[['_publishedMediaId_', 'pshContent.content.media.id'], ['_keptMediaId_', 'content.media.id']].map(([name, path]) => ({
    before: (adapter) => adapter.ensureIndex('Snippet', { fields: {} }, [path], name),
    className: 'Snippet',
    name,
    declaration: { keys: { [path]: 1 } },
    declaredFields: { pshContent: { type: 'Object' }, content: { type: 'Object' } },
  })),
]

describe('an ensured index, as it reaches MongoDB', () => {
  test.each(BEFORE_AND_AFTER.map((entry) => [`${entry.className}.${entry.name}`, entry]))('%s: the same keys and options Parse\'s own adapter sent before the move', async (_, entry) => {
    const { adapter, created } = recordingAdapter()
    await entry.before(adapter)
    const [before] = created
    const after = storageIndexFrom({ className: entry.className, name: entry.name, declaration: entry.declaration, declaredFields: entry.declaredFields, transformKey })
    expect(after.keys).toEqual(before.keys)
    // Parse's adapter names a unique index nothing (MongoDB names it `key_1`); the declaration names it that very name.
    const nameBefore = before.options.name ?? defaultMongoNameOf(before.keys)
    expect(after.options).toEqual({ ...before.options, name: nameBefore })
  })

  test('maps objectId, the native times and pointers to their storage names, and leaves dotted paths as written', () => {
    const { keys } = storageIndexFrom({
      className: 'Foo',
      name: 'i',
      declaration: { keys: { objectId: 1, createdAt: -1, owner: 1, 'content.media.id': 1, plain: -1 } },
      declaredFields: { owner: PARSE_POINTER('_User') },
      transformKey,
    })
    expect(keys).toEqual({ _id: 1, _created_at: -1, _p_owner: 1, 'content.media.id': 1, plain: -1 })
    expect(Object.keys(keys)).toEqual(['_id', '_created_at', '_p_owner', 'content.media.id', 'plain'])
  })

  test('a field type given with the declaration wins over none in the schema, and a partial index is not sparse', () => {
    const { keys, options } = storageIndexFrom({
      className: 'Foo',
      name: 'partial',
      declaration: { keys: { target: 1 }, isUnique: true, partialFilter: { target: { $exists: true }, $or: [{ updatedAt: { $gt: 0 } }, { status: 'live' }] }, fieldTypes: { target: PARSE_POINTER('Bar') } },
      transformKey,
    })
    expect(keys).toEqual({ _p_target: 1 })
    expect(options).toEqual({ name: 'partial', background: true, unique: true, partialFilterExpression: { _p_target: { $exists: true }, $or: [{ _updated_at: { $gt: 0 } }, { status: 'live' }] } })
  })

  test('refuses what it cannot make, saying why', () => {
    expect(problemsOfTheDeclaration({ keys: {} })).toEqual(['`keys` names no field'])
    expect(problemsOfTheDeclaration({ keys: { a: 2 }, isUnique: 'yes', unique: true })).toEqual([
      'the direction of `a` is neither 1 nor -1',
      '`isUnique` is not a boolean',
      '`unique` is not an option of an ensured index',
    ])
    expect(problemsOfTheDeclaration({ keys: { a: 1 }, isSparse: true, partialFilter: { a: 1 } })).toEqual(['an index is either sparse or partial, not both'])
    expect(problemsOfTheDeclaration(null)).toEqual(['the declaration is not an object'])
    expect(() => storageIndexFrom({ className: 'Foo', name: '', declaration: { keys: { a: 1 } }, transformKey })).toThrow('has no name')
    expect(() => storageIndexFrom({ className: 'Foo', name: 'i', declaration: { keys: [] }, transformKey })).toThrow('Foo.i cannot be made')
  })
})

describe('Servable.App.Indexes.ensure', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'info').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  test('makes the index through the adapter, typed by the schema the app declared', async () => {
    const { adapter, created } = recordingAdapter()
    const indexes = createIndexes({ resolveAdapter: async () => adapter, declaredClasses: () => [{ className: 'PodcastEpisode', fields: { audio: PARSE_POINTER('AudioRaw') } }] })
    expect(await indexes.ensure({ className: 'PodcastEpisode', name: '_audio_', keys: { audio: 1 } })).toEqual({ isEnsured: true, className: 'PodcastEpisode', name: '_audio_' })
    expect(created).toEqual([{ className: 'PodcastEpisode', keys: { _p_audio: 1 }, options: { name: '_audio_', background: true, sparse: true } }])
  })

  test('never throws: a clash, duplicates, a broken declaration, no adapter or another storage each answer why', async () => {
    const failingAdapter = (error) => ({ _adaptiveCollection: async () => ({ _mongoCollection: { createIndex: async () => { throw error } } }) })
    const ensureWith = (adapter, props = {}) => createIndexes({ resolveAdapter: async () => adapter, declaredClasses: () => [] }).ensure({ className: 'Foo', name: 'i', keys: { a: 1 }, ...props })
    expect((await ensureWith(failingAdapter(Object.assign(new Error('Index already exists with a different name'), { code: 85 })))).reason).toMatch(/already exists under another name/)
    expect((await ensureWith(failingAdapter(Object.assign(new Error('An existing index has the same name'), { code: 86 })))).reason).toMatch(/name is already taken/)
    expect((await ensureWith(failingAdapter(Object.assign(new Error('E11000 duplicate key'), { code: 11000 })), { isUnique: true })).reason).toMatch(/holds duplicates/)
    expect((await ensureWith(failingAdapter(new Error('network')))).reason).toBe('network')
    expect((await ensureWith({ ensureIndex: () => {} })).reason).toMatch(/not MongoDB's/)
    expect((await ensureWith(undefined)).isEnsured).toBe(false)
    expect((await ensureWith(recordingAdapter().adapter, { keys: {} })).reason).toMatch(/names no field/)
    expect((await createIndexes({ resolveAdapter: async () => { throw new Error('no config') }, declaredClasses: () => [] }).ensure({ className: 'Foo', name: 'i', keys: { a: 1 } })).reason).toBe('no config')
    expect(console.error).toHaveBeenCalledTimes(8)
  })
})

describe('the declared indexes at boot', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'info').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  const classes = [
    { className: 'UniqueClaim', fields: { key: { type: 'String' } }, ensuredIndexes: { key_1: { keys: { key: 1 }, isUnique: true } } },
    { className: 'Plain', fields: {}, indexes: { _a_: { a: 1 } } },
    { className: 'Snippet', fields: {}, ensuredIndexes: { _bad_: { keys: {} }, _keptMediaId_: { keys: { 'content.media.id': 1 } } } },
  ]

  test('are made one after the other, a failure never stopping the next, and summed up in one line', async () => {
    const { adapter, created } = recordingAdapter()
    const indexes = createIndexes({ resolveAdapter: async () => adapter, declaredClasses: () => classes })
    const answer = await indexes.ensureTheDeclared({ classes })
    expect(answer.ensured).toEqual(['UniqueClaim.key_1', 'Snippet._keptMediaId_'])
    expect(answer.failed.map(({ index }) => index)).toEqual(['Snippet._bad_'])
    expect(created.map(({ options }) => options.name)).toEqual(['key_1', '_keptMediaId_'])
    expect(console.info).toHaveBeenCalledWith('[ENGINE] [indexes]', 'declared indexes ensured', expect.objectContaining({ ensured: 2, failed: 1, failedIndexes: ['Snippet._bad_'] }))
  })

  test('are started without the boot waiting for them, and not at all when switched off or none is declared', async () => {
    let releaseTheBuild
    const ensureTheDeclared = jest.fn(() => new Promise((resolve) => { releaseTheBuild = resolve }))
    const run = startEnsuringTheDeclaredIndexes({ indexes: { ensureTheDeclared }, classes, areDeclaredIndexesEnsured: true })
    // The boot carries on while the build has not finished.
    expect(run).toBeInstanceOf(Promise)
    await Promise.resolve()
    expect(ensureTheDeclared).toHaveBeenCalledWith({ classes: [classes[0], classes[2]] })
    releaseTheBuild({ ensured: [], failed: [] })
    await expect(run).resolves.toEqual({ ensured: [], failed: [] })

    expect(startEnsuringTheDeclaredIndexes({ indexes: { ensureTheDeclared }, classes, areDeclaredIndexesEnsured: false })).toBeNull()
    expect(startEnsuringTheDeclaredIndexes({ indexes: { ensureTheDeclared }, classes: [classes[1]], areDeclaredIndexesEnsured: true })).toBeNull()
    expect(ensureTheDeclared).toHaveBeenCalledTimes(1)
    const failing = startEnsuringTheDeclaredIndexes({ indexes: { ensureTheDeclared: async () => { throw new Error('boom') } }, classes, areDeclaredIndexesEnsured: true })
    await expect(failing).resolves.toBeNull()
  })

  test('never reach Parse Server: its schema option gets each class without them', () => {
    expect(parseDefinitionOf(classes[0])).toEqual({ className: 'UniqueClaim', fields: { key: { type: 'String' } } })
    expect(parseDefinitionOf(classes[1])).toEqual(classes[1])
  })
})
