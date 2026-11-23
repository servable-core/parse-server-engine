import { jest } from '@jest/globals'
import express from 'express'
import { MongoClient } from 'mongodb'
import launch from '../../src/launch/index.js'
import { createSessionInvalidations, resetSessionInvalidationsForTests } from '../../src/sessionInvalidations/index.js'

// The session lookup of every signed-in request, against a real Parse Server and a real MongoDB (F3, Q1092 a):
// - the engine makes `_Session._session_token_1` after boot, for an app that declares nothing, and the lookup by
//   token then uses it (IXSCAN, one document examined) instead of scanning every session;
// - Parse's own writes are reported to `Servable.App.SessionInvalidations`: a sign-out (REST logout), a session
//   destroyed, a user saved, a session renewed.
//
// Same scratch MongoDB as the other integration tests (SERVABLE_TEST_DATABASE_URI, defaulting to 127.0.0.1:27018);
// skips when none is reachable. Its own throwaway database, dropped before and after.
const TEST_SERVER_URI = process.env.SERVABLE_TEST_DATABASE_URI
  || 'mongodb://root:DATABASE_PASSWORD_TO_CHANGE@127.0.0.1:27018/?authSource=admin'
const DB = 'servable-session-lookup-test'
const APP_ID = 'session-lookup-test'
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

const waitFor = async (isDone, milliseconds = 15000) => {
  const deadline = Date.now() + milliseconds
  while (Date.now() < deadline) {
    if (await isDone()) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

describeIfMongo('session lookup (real Parse Server, real MongoDB)', () => {
  let db
  let Parse

  beforeAll(async () => {
    db = client.db(DB)
    await db.dropDatabase()
    globalThis.Servable = {}
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'info').mockImplementation(() => {})
    jest.spyOn(console, 'debug').mockImplementation(() => {})
    // Sessions made by hand before the index exists, as a production collection would hold.
    const now = Date.now()
    await db.collection('_Session').insertMany(Array.from({ length: 2000 }, (_, index) => ({
      _id: `seed${index}`,
      _session_token: `r:seed${String(index).padStart(28, '0')}`,
      _p_user: `_User$seedUser${index}`,
      expiresAt: new Date(now + 86400000),
      _created_at: new Date(now),
      _updated_at: new Date(now),
    })))
    const configuration = {
      config: {
        parse: { appId: APP_ID, masterKey: `${APP_ID}-master-key`, databaseURI, serverURL: 'http://127.0.0.1:1/parse', mountPath: '/parse', verbose: 'error' },
        engine: {},
      },
    }
    await launch({ schema: { appProtocol: { schema: { classes: { all: [] } } }, liveClasses: [] }, configuration, app: express() })
    Parse = globalThis.Parse
  }, 60000)

  afterAll(async () => {
    resetSessionInvalidationsForTests()
    // Parse Server checks its serverURL in the background after it starts; let that finish before tearing down.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    // @ts-ignore - parse-server ships no declarations for its compiled lib/ files.
    const ConfigModule = await import('parse-server/lib/Config.js')
    const Config = [ConfigModule.default, ConfigModule.default?.default].find((candidate) => typeof candidate?.get === 'function')
    await Config?.get(APP_ID)?.database?.adapter?.handleShutdown?.()
    await db.dropDatabase()
    await client.close()
    delete globalThis.Servable
    jest.restoreAllMocks()
  })

  test('the engine makes the _Session token index after boot, and the lookup by token uses it', async () => {
    const lookup = { _session_token: 'r:seed' + String(1234).padStart(28, '0') }
    const isMade = await waitFor(async () => (await db.collection('_Session').indexes()).some(({ name }) => name === '_session_token_1'))
    expect(isMade).toBe(true)
    const index = (await db.collection('_Session').indexes()).find(({ name }) => name === '_session_token_1')
    expect(index).toEqual(expect.objectContaining({ key: { _session_token: 1 }, unique: true, sparse: true }))

    // Listed while it is still being built: the lookup uses it once the build has finished.
    let plan = null
    await waitFor(async () => {
      plan = await db.collection('_Session').find({ ...lookup, expiresAt: { $gt: new Date() } }).limit(1).explain('executionStats')
      return JSON.stringify(plan.queryPlanner.winningPlan).includes('IXSCAN')
    })
    const stages = JSON.stringify(plan.queryPlanner.winningPlan)
    expect(stages).toContain('IXSCAN')
    expect(stages).toContain('_session_token_1')
    expect(plan.executionStats.totalDocsExamined).toBe(1)

    // The same query without the index scans every session (what production does today).
    const scan = await db.collection('_Session').find({ ...lookup, expiresAt: { $gt: new Date() } }).hint({ $natural: 1 }).limit(1).explain('executionStats')
    expect(scan.executionStats.totalDocsExamined).toBeGreaterThan(1000)
  }, 30000)

  test('sign-out, session destroy, user save and session renewal are reported', async () => {
    const reports = []
    const subscription = await createSessionInvalidations({ applicationIdOf: () => APP_ID }).subscribe((invalidation) => reports.push(invalidation))
    expect(subscription.isReported).toBe(true)

    const rest = Parse.CoreManager.getRESTController()
    const logIn = async () => (await rest.request('POST', 'login', { username: 'ada', password: 'a-long-password-1' }, {})).sessionToken
    const signedUp = await rest.request('POST', 'users', { username: 'ada', password: 'a-long-password-1', email: 'ada@example.com' }, {})
    // A sign-up through direct access answers no session: the user signs in.
    const firstToken = await logIn()
    expect(firstToken).toMatch(/^r:/)
    const user = Parse.User.createWithoutData(signedUp.objectId)

    // A user saved: Parse drops each of its sessions from its own cache (one report per token), then the write is
    // reported by user id.
    reports.length = 0
    user.set('displayName', 'Ada L.')
    await user.save(null, { useMasterKey: true })
    expect(reports).toContainEqual({ sessionToken: firstToken })
    expect(reports).toContainEqual({ userId: user.id })

    // A sign-out through Parse's own route.
    reports.length = 0
    await Parse.CoreManager.getRESTController().request('POST', 'logout', {}, { sessionToken: firstToken })
    expect(reports).toContainEqual({ sessionToken: firstToken })
    expect(await new Parse.Query('_Session').equalTo('sessionToken', firstToken).first({ useMasterKey: true })).toBeUndefined()

    // A session destroyed by the server (a revocation).
    const secondToken = await logIn()
    const session = await new Parse.Query('_Session').equalTo('sessionToken', secondToken).first({ useMasterKey: true })
    reports.length = 0
    await session.destroy({ useMasterKey: true })
    expect(reports).toContainEqual({ sessionToken: secondToken })
    expect(reports).toContainEqual({ sessionId: session.id })

    // A session changed by the server (a field of the app's, such as the refresh token's digest).
    const thirdSession = await new Parse.Query('_Session').equalTo('sessionToken', await logIn()).first({ useMasterKey: true })
    reports.length = 0
    thirdSession.set('refreshTokenHash', 'digest-2')
    await thirdSession.save(null, { useMasterKey: true })
    expect(reports).toContainEqual({ sessionId: thirdSession.id })

    // Another class's writes say nothing.
    reports.length = 0
    const other = new Parse.Object('Thing')
    await other.save({ a: 1 }, { useMasterKey: true })
    await other.save({ a: 2 }, { useMasterKey: true })
    await other.destroy({ useMasterKey: true })
    expect(reports).toEqual([])

    subscription.unsubscribe()
    reports.length = 0
    user.set('displayName', 'Ada')
    await user.save(null, { useMasterKey: true })
    expect(reports).toEqual([])
  }, 30000)
})
