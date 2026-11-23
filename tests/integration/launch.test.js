import { jest } from '@jest/globals'
import express from 'express'
import { MongoClient } from 'mongodb'
import launch from '../../src/launch/index.js'

// The engine's launch, end to end, against a real MongoDB (never a port: Parse Server is mounted on an Express app that
// does not listen): Parse Server gets the class definitions without `ensuredIndexes`, accepts them, and starts; the
// patches are installed once it has; the declared indexes are made after it, without the launch waiting for them.
//
// Same scratch MongoDB as the other integration tests (SERVABLE_TEST_DATABASE_URI, defaulting to 127.0.0.1:27018);
// skips when none is reachable. Its own throwaway database, dropped before and after.
const TEST_SERVER_URI = process.env.SERVABLE_TEST_DATABASE_URI
  || 'mongodb://root:DATABASE_PASSWORD_TO_CHANGE@127.0.0.1:27018/?authSource=admin'
const DB = 'servable-launch-test'
const databaseURI = (() => {
  const url = new URL(TEST_SERVER_URI)
  url.pathname = `/${DB}`
  return url.toString()
})()

let client = null
try {
  client = await new MongoClient(TEST_SERVER_URI, { serverSelectionTimeoutMS: 2000 }).connect()
} catch {
  client = null
}

const describeIfMongo = client ? describe : describe.skip

const CLASSES = [
  {
    className: 'UniqueClaim',
    fields: { key: { type: 'String' } },
    indexes: { _key_: { key: 1 } },
    classLevelPermissions: {},
    ensuredIndexes: { key_1: { keys: { key: 1 }, isUnique: true } },
  },
  {
    className: 'Snippet',
    fields: { content: { type: 'Object' }, audio: { type: 'Pointer', targetClass: 'UniqueClaim' } },
    classLevelPermissions: {},
    ensuredIndexes: { _keptMediaId_: { keys: { 'content.media.id': 1 } }, _audio_: { keys: { audio: 1 } } },
  },
]

describeIfMongo('the engine launch (real Parse Server, real MongoDB)', () => {
  let db

  beforeAll(async () => {
    db = client.db(DB)
    await db.dropDatabase()
    globalThis.Servable = {}
  })

  afterAll(async () => {
    // launch() answers the mounted Express app, not the ParseServer: its MongoDB connection is closed through Parse's config.
    // @ts-ignore - parse-server ships no declarations for its compiled lib/ files.
    const ConfigModule = await import('parse-server/lib/Config.js')
    const Config = [ConfigModule.default, ConfigModule.default?.default].find((candidate) => typeof candidate?.get === 'function')
    await Config?.get('launch-test')?.database?.adapter?.handleShutdown?.()
    await db.dropDatabase()
    await client.close()
    delete globalThis.Servable
  })

  test('starts Parse with the schema, installs the patches, then makes the declared indexes in the background', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'debug').mockImplementation(() => {})
    const infos = []
    jest.spyOn(console, 'info').mockImplementation((...parts) => infos.push(parts))
    const configuration = {
      config: {
        parse: { appId: 'launch-test', masterKey: 'launch-test-master-key', databaseURI, serverURL: 'http://127.0.0.1:1/parse', mountPath: '/parse', verbose: 'error' },
        engine: { isSchemaControllerReuseEnabled: true, isFastObjectGetEnabled: false },
      },
    }
    const schema = { appProtocol: { schema: { classes: { all: CLASSES } } }, liveClasses: [] }

    const answer = await launch({ schema, configuration, app: express() })

    // Parse got the definitions without the engine's own key, and made its own index.
    expect(answer.config.parse.schema.definitions.map((definition) => Object.keys(definition).includes('ensuredIndexes'))).toEqual([false, false])
    const schemaRow = await db.collection('_SCHEMA').findOne({ _id: 'UniqueClaim' })
    expect(schemaRow?._metadata?.indexes).toEqual(expect.objectContaining({ _key_: { key: 1 } }))
    // The patches were installed once Parse had started.
    expect(infos).toContainEqual(['[ENGINE] patches', { schemaControllerReuse: 'installed', fastObjectGet: 'switched off', lazyFetchSnapshot: 'switched off' }])

    // The declared indexes come after the launch has returned.
    const deadline = Date.now() + 10000
    let names = []
    while (Date.now() < deadline) {
      names = [...(await db.collection('UniqueClaim').indexes()), ...(await db.collection('Snippet').indexes().catch(() => []))].map(({ name }) => name)
      if (['key_1', '_keptMediaId_', '_audio_'].every((name) => names.includes(name))) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(names).toEqual(expect.arrayContaining(['_key_', 'key_1', '_keptMediaId_', '_audio_']))
    const audio = (await db.collection('Snippet').indexes()).find(({ name }) => name === '_audio_')
    expect(audio.key).toEqual({ _p_audio: 1 })
    jest.restoreAllMocks()
  }, 30000)
})
