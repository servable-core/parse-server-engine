import { jest } from '@jest/globals'
import express from 'express'
import fc from 'fast-check'
import { MongoClient } from 'mongodb'
import { ParseServer } from 'parse-server'

// @servable/server registers a save or delete trigger only where a protocol or the class has a handler (its trigger
// plan, framework audit 2026-11-23, F1). Before, every class had all four, often with nothing to run. This test pins
// what that change alters and what it does not, against the real Parse Server (direct access) and SDK:
//
//   - a class whose triggers run nothing and a class with no trigger answer every caller the same, for random objects
//     and random sequences of saves (set, unset, increment, add, addUnique, remove, a relation) and deletes, an object
//     that is gone included: same object state in the SDK after each save, same stored document, same error codes;
//   - except a save that sets a path inside an object field ('nested.a'): Parse handles it differently once a
//     beforeSave or afterSave exists (it rebuilds the whole object from the stored one, then answers it back). Those
//     differences are pinned one by one below, so a Parse upgrade that changes them shows.
//
// Same scratch MongoDB as the other integration tests (SERVABLE_TEST_DATABASE_URI, defaulting to 127.0.0.1:27018);
// skipped when none is reachable. Its own throwaway database, dropped before and after.
const TEST_SERVER_URI = process.env.SERVABLE_TEST_DATABASE_URI
  || 'mongodb://root:DATABASE_PASSWORD_TO_CHANGE@127.0.0.1:27018/?authSource=admin'
const DB = 'servable-empty-triggers-test'
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

const fieldNames = ['name', 'count', 'tags', 'nested', 'flag', 'when']

const valueArbitrary = fc.oneof(
  fc.integer({ min: -5, max: 5 }),
  fc.string({ maxLength: 4 }),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.oneof(fc.integer({ min: 0, max: 3 }), fc.constantFrom('x', 'y')), { maxLength: 3 }),
  fc.dictionary(fc.constantFrom('a', 'b'), fc.integer({ min: 0, max: 3 }), { maxKeys: 2 }),
  fc.date({ min: new Date(0), max: new Date(4102444800000), noInvalidDate: true }),
)

const operationArbitrary = fc.oneof(
  fc.record({ kind: fc.constant('set'), name: fc.constantFrom(...fieldNames), value: valueArbitrary }),
  fc.record({ kind: fc.constant('unset'), name: fc.constantFrom(...fieldNames) }),
  fc.record({ kind: fc.constant('increment'), name: fc.constantFrom('count', 'fresh'), by: fc.integer({ min: -3, max: 3 }) }),
  fc.record({ kind: fc.constantFrom('add', 'addUnique', 'remove'), name: fc.constantFrom('tags', 'list'), value: fc.oneof(fc.integer({ min: 0, max: 3 }), fc.constantFrom('x', 'y')) }),
  fc.record({ kind: fc.constant('relation') }),
)

const scenarioArbitrary = fc.record({
  initial: fc.dictionary(fc.constantFrom(...fieldNames), valueArbitrary, { maxKeys: 4 }),
  saves: fc.array(fc.array(operationArbitrary, { minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 3 }),
  deletesTwice: fc.boolean(),
})

const outcomeOf = async (promise) => {
  try {
    await promise
    return { isOk: true }
  } catch (error) {
    return { isOk: false, code: error.code }
  }
}

describeIfMongo('a class whose triggers run nothing answers like a class without triggers (real Parse Server)', () => {
  let db
  let Parse
  let target

  beforeAll(async () => {
    db = client.db(DB)
    await db.dropDatabase()
    const server = new ParseServer({
      appId: 'empty-triggers-test',
      masterKey: 'empty-triggers-master-key',
      databaseURI,
      serverURL: 'http://127.0.0.1:1/parse',
      cloud: () => {},
      verbose: false,
      silent: true,
      logLevel: 'error',
    })
    await server.start()
    express().use('/parse', server.app)
    Parse = globalThis.Parse
    const nothing = async () => {}
    Parse.Cloud.beforeSave('Triggered', nothing)
    Parse.Cloud.afterSave('Triggered', nothing)
    Parse.Cloud.beforeDelete('Triggered', nothing)
    Parse.Cloud.afterDelete('Triggered', nothing)
    for (const register of ['beforeSave', 'afterSave', 'beforeDelete', 'afterDelete']) {
      Parse.Cloud[register]('TriggeredAcl', nothing)
    }
    target = await new Parse.Object('Target').save(null, { useMasterKey: true })
  }, 30000)

  afterAll(async () => {
    // @ts-ignore - parse-server ships no declarations for its compiled lib/ files.
    const ConfigModule = await import('parse-server/lib/Config.js')
    const Config = [ConfigModule.default, ConfigModule.default?.default].find((candidate) => typeof candidate?.get === 'function')
    await Config?.get('empty-triggers-test')?.database?.adapter?.handleShutdown?.()
    await db.dropDatabase()
    await client.close()
  })

  const apply = (object, operation) => {
    switch (operation.kind) {
      case 'set': return object.set(operation.name, operation.value)
      case 'unset': return object.unset(operation.name)
      case 'increment': return object.increment(operation.name, operation.by)
      case 'add': return object.add(operation.name, operation.value)
      case 'addUnique': return object.addUnique(operation.name, operation.value)
      case 'remove': return object.remove(operation.name, operation.value)
      case 'dotted': return object.set(operation.name, operation.value)
      case 'relation': return object.relation('rel').add(target)
    }
  }

  // What a caller can see of an object, without what differs between two objects by construction.
  const visibleStateOf = (object) => {
    const { objectId, createdAt, updatedAt, ...attributes } = object.toJSON()
    const serverData = Parse._encode(object._getServerData())
    delete serverData.createdAt
    delete serverData.updatedAt
    return { attributes, serverData, dirtyKeys: object.dirtyKeys().sort(), isDirty: object.dirty() }
  }

  const storedDocumentOf = async (className, objectId) => {
    const document = await db.collection(className).findOne({ _id: objectId })
    if (!document) {
      return null
    }
    const { _id, _created_at, _updated_at, ...stored } = document
    return stored
  }

  // Whether what the SDK holds after a save is what the database holds: the object fetched again answers the same.
  const isFaithfulToTheDatabase = async (object) => {
    if (!object.id) {
      return true
    }
    const fetched = await new Parse.Query(object.className).get(object.id, { useMasterKey: true }).catch(() => null)
    const { createdAt, updatedAt, ...held } = object.toJSON()
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...stored } = fetched ? fetched.toJSON() : {}
    return JSON.stringify(Parse._encode(held)) === JSON.stringify(Parse._encode(stored)) && !object.dirty()
  }

  const savedStepOf = async (object, className) => {
    const save = await outcomeOf(object.save(null, { useMasterKey: true }))
    return {
      save,
      state: visibleStateOf(object),
      isFaithful: save.isOk ? await isFaithfulToTheDatabase(object) : null,
      stored: await storedDocumentOf(className, object.id),
    }
  }

  const runOn = async (className, scenario) => {
    const steps = []
    const object = new Parse.Object(className)
    for (const [name, value] of Object.entries(scenario.initial)) {
      object.set(name, value)
    }
    steps.push(await savedStepOf(object, className))
    for (const operations of scenario.saves) {
      const refusals = []
      for (const operation of operations) {
        try {
          apply(object, operation)
        } catch (error) {
          refusals.push(error.message)
        }
      }
      steps.push({ refusals, ...(await savedStepOf(object, className)) })
    }
    const deletes = [await outcomeOf(object.destroy({ useMasterKey: true }))]
    if (scenario.deletesTwice) {
      deletes.push(await outcomeOf(object.destroy({ useMasterKey: true })))
    }
    return { steps, deletes, storedAfterTheDeletes: await storedDocumentOf(className, object.id) }
  }

  // Parse answers a value of the wrong type with 107 (INVALID_JSON) once a beforeSave exists, 111 (INCORRECT_TYPE)
  // without: the same refusal.
  const sameRefusalCodeOf = (code) => (code === Parse.Error.INVALID_JSON ? Parse.Error.INCORRECT_TYPE : code)

  test('random saves and deletes: same stored documents, same successes and refusals; the SDK state differs only where the triggered one was already wrong', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const differencesSeen = { sdkStateWrongWithTheTriggerRightWithout: 0, sdkStateWrongEitherWay: 0, refusalCode107Versus111: 0 }
    let runCount = 0
    const nothing = async () => {}
    await fc.assert(fc.asyncProperty(scenarioArbitrary, async (scenario) => {
      // Classes of their own for each run, so the type one run gave a field never decides the next run.
      runCount += 1
      const triggeredClassName = `Triggered${runCount}`
      for (const register of ['beforeSave', 'afterSave', 'beforeDelete', 'afterDelete']) {
        Parse.Cloud[register](triggeredClassName, nothing)
      }
      const triggered = await runOn(triggeredClassName, scenario)
      const plain = await runOn(`Plain${runCount}`, scenario)

      expect(triggered.deletes).toEqual(plain.deletes)
      expect(triggered.storedAfterTheDeletes).toEqual(plain.storedAfterTheDeletes)
      expect(triggered.steps.length).toBe(plain.steps.length)
      triggered.steps.forEach((triggeredStep, index) => {
        const plainStep = plain.steps[index]
        expect(triggeredStep.refusals).toEqual(plainStep.refusals)
        expect(triggeredStep.stored).toEqual(plainStep.stored)
        expect(triggeredStep.save.isOk).toBe(plainStep.save.isOk)
        expect(sameRefusalCodeOf(triggeredStep.save.code)).toBe(sameRefusalCodeOf(plainStep.save.code))
        if (triggeredStep.save.code !== plainStep.save.code) {
          differencesSeen.refusalCode107Versus111 += 1
        }
        if (JSON.stringify(triggeredStep.state) !== JSON.stringify(plainStep.state)) {
          // The answer changes only where the triggered one did not hold what the database holds.
          expect({ index, triggeredIsFaithful: triggeredStep.isFaithful }).toEqual({ index, triggeredIsFaithful: false })
          if (plainStep.isFaithful) {
            differencesSeen.sdkStateWrongWithTheTriggerRightWithout += 1
          } else {
            differencesSeen.sdkStateWrongEitherWay += 1
          }
        }
      })
    }), { numRuns: 500, seed: 20261123 })
    process.stdout.write(`[empty triggers] ${runCount} random scenarios; differences, each explained: ${JSON.stringify(differencesSeen)}\n`)
    jest.restoreAllMocks()
  }, 600000)

  // Without the master key, against what the object's ACL allows: the same answers.
  test.each([
    ['public read only', { '*': { read: true } }],
    ['public write only', { '*': { write: true } }],
    ['nobody', {}],
    ['everybody', { '*': { read: true, write: true } }],
  ])('saves and deletes without the master key, ACL %s: the same answers', async (_name, aclJSON) => {
    const outcomesOn = async (className) => {
      const object = new Parse.Object(className)
      object.set('name', 'x')
      object.setACL(new Parse.ACL(aclJSON))
      await object.save(null, { useMasterKey: true })
      const asAnybody = Parse.Object.createWithoutData(className, object.id)
      asAnybody.set('name', 'y')
      asAnybody.increment('count', 1)
      const save = await outcomeOf(asAnybody.save())
      const stored = await storedDocumentOf(className, object.id)
      const deleted = await outcomeOf(Parse.Object.createWithoutData(className, object.id).destroy())
      const missingDeleted = await outcomeOf(Parse.Object.createWithoutData(className, 'doesNotExist').destroy())
      return { save, stored: stored && { name: stored.name, count: stored.count }, deleted, missingDeleted, isStillThere: Boolean(await storedDocumentOf(className, object.id)) }
    }
    expect(await outcomesOn('TriggeredAcl')).toEqual(await outcomesOn('PlainAcl'))
  })

  // A save that sets a path inside an object field, with and without (empty) triggers, each on classes of its own.
  let dottedClassCount = 0
  const dottedSaveOn = async (kind, { initial, change }) => {
    dottedClassCount += 1
    const className = `${kind}Dotted${dottedClassCount}`
    if (kind === 'Triggered') {
      const nothing = async () => {}
      Parse.Cloud.beforeSave(className, nothing)
      Parse.Cloud.afterSave(className, nothing)
    }
    const object = new Parse.Object(className)
    object.set(initial)
    await object.save(null, { useMasterKey: true })
    change(object)
    const save = await outcomeOf(object.save(null, { useMasterKey: true }))
    const stored = await new Parse.Query(className).get(object.id, { useMasterKey: true })
    return { save, inTheSdk: object.toJSON().nested, dirtyKeysAfterTheSave: object.dirtyKeys().sort(), stored: stored.toJSON().nested }
  }

  test('dotted saves: the same where the object field exists', async () => {
    const scenario = { initial: { nested: { b: 1 } }, change: (object) => { object.set('nested.a', 0); object.set('nested.c', 2) } }
    expect(await dottedSaveOn('Triggered', scenario)).toEqual(await dottedSaveOn('Plain', scenario))
  })

  test('dotted saves: where the object field is missing, the SDK keeps it dirty after the save without a trigger', async () => {
    const scenario = { initial: {}, change: (object) => object.set('nested.a', 0) }
    expect(await dottedSaveOn('Triggered', scenario)).toEqual({ save: { isOk: true }, inTheSdk: { a: 0 }, dirtyKeysAfterTheSave: [], stored: { a: 0 } })
    expect(await dottedSaveOn('Plain', scenario)).toEqual({ save: { isOk: true }, inTheSdk: { a: 0 }, dirtyKeysAfterTheSave: ['nested'], stored: { a: 0 } })
  })

  test('dotted saves: into a field that is not an object, a trigger hides the refusal and loses the change', async () => {
    const scenario = { initial: { when: new Date(0) }, change: (object) => object.set('when.a', 0) }
    const withEmptyTriggers = await dottedSaveOn('Triggered', scenario)
    const withoutTriggers = await dottedSaveOn('Plain', scenario)
    expect(withEmptyTriggers.save).toEqual({ isOk: true })
    expect(withoutTriggers.save).toEqual({ isOk: false, code: Parse.Error.INCORRECT_TYPE })
  })

  test('dotted saves: unsetting a field and setting a path inside it in one save, a trigger hides the conflict and loses the change', async () => {
    const scenario = { initial: { nested: { b: 1 } }, change: (object) => { object.unset('nested'); object.set('nested.a', 0) } }
    const withEmptyTriggers = await dottedSaveOn('Triggered', scenario)
    const withoutTriggers = await dottedSaveOn('Plain', scenario)
    expect(withEmptyTriggers.save).toEqual({ isOk: true })
    expect(withEmptyTriggers.inTheSdk).toEqual({ a: 0 })
    expect(withEmptyTriggers.stored).not.toEqual({ a: 0 })
    expect(withoutTriggers.save.isOk).toBe(false)
  })
})

