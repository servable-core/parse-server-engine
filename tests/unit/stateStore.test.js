import createStateStore, { resolveDatabaseURI } from '../../src/stateStore/index.js'

// No MongoDB needed here - see tests/integration/stateStore.test.js for the real-database cases.
// `yarn test:unit` preloads dotenv, so the env var resolveDatabaseURI falls back to is saved and
// cleared around each test.
let savedEngineDatabaseURI

beforeEach(() => {
  savedEngineDatabaseURI = process.env.ENGINE_DATABASE_URI
  delete process.env.ENGINE_DATABASE_URI
})

afterEach(() => {
  if (savedEngineDatabaseURI === undefined) delete process.env.ENGINE_DATABASE_URI
  else process.env.ENGINE_DATABASE_URI = savedEngineDatabaseURI
})

describe('state store URI resolution', () => {
  test('engine database: envs.databaseURI, then parse config, then ENGINE_DATABASE_URI', () => {
    process.env.ENGINE_DATABASE_URI = 'mongodb://env'
    const parse = { configuration: { config: { parse: { databaseURI: 'mongodb://parse' } } } }

    expect(resolveDatabaseURI({ envs: { databaseURI: 'mongodb://envs' }, ...parse })).toBe('mongodb://envs')
    expect(resolveDatabaseURI({ envs: {}, ...parse })).toBe('mongodb://parse')
    expect(resolveDatabaseURI({})).toBe('mongodb://env')
  })

  test('createStateStore without any engine database URI fails with an explicit message', async () => {
    await expect(createStateStore({ servableConfig: { envs: {} } })).rejects.toThrow(/no engine database URI/)
  })

  test('the engine database is the only database the store knows about', async () => {
    // Nothing here reads a utils database, so an unreachable one in the environment is irrelevant:
    // this still fails on the missing engine URI and nothing else. Copying state out of the old
    // utils database was a one-off script in the app that owned it, never part of this package.
    process.env.SERVABLE_UTILS_DATABASE_URI = 'mongodb://127.0.0.1:1/utils'
    try {
      await expect(createStateStore({ servableConfig: { envs: {} } })).rejects.toThrow(/no engine database URI/)
    } finally {
      delete process.env.SERVABLE_UTILS_DATABASE_URI
    }
  })
})
