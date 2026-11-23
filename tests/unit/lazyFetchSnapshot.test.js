import { jest } from '@jest/globals'
import fc from 'fast-check'
import Parse from 'parse/node.js'
import { createTheLazyFetchSnapshot, installTheLazyFetchSnapshot, isDecodedIntoFreshPlainValues, sdkModules } from '../../src/patches/lazyFetchSnapshot.js'
import { engineOptionsFrom } from '../../src/options/index.js'

// The lazy fetch snapshot (framework audit 2026-11-23, F6) against the SDK as installed (parse 6.1.1), in the server's
// mode (unique instances). Each random scenario runs twice, on the SDK alone and with the patch installed, against the
// same fake server (a REST controller answering queries, fetches and saves from the scenario), and every observable
// answer is compared: dirty(), dirty(field), dirtyKeys(), toJSON(), what a save would send (_getSaveJSON), the values
// get() returns, the snapshot cache itself, and every error, in order. Scenarios: random server data (plain values,
// nested objects and arrays, dates, invalid dates, pointers, objects, files, relations, geo points, unknown and op
// types), fetched by a query (sometimes with a select), then random sequences of in-place changes of nested objects and
// arrays got with get(), set, unset, increment, add, addUnique, remove, dotted sets, reverts, saves (answered, or
// failed), fetches, clones, new queries and reads of the dirty state.

Parse.initialize('lazy-fetch-snapshot-test', 'javascript-key', 'master-key')
Parse.serverURL = 'http://127.0.0.1:1/parse'
Parse.Object.disableSingleInstance()
const { CoreManager } = Parse

const fieldNames = ['tags', 'meta', 'list', 'when', 'name', 'count', 'owner', 'deep', 'mixed']
const CLASS_NAME = 'Thing'
const OBJECT_ID = 'thing1'

const leafArbitrary = fc.oneof(
  fc.constant(null), fc.boolean(), fc.integer({ min: -3, max: 3 }), fc.constantFrom('a', 'b', ''), fc.double({ noNaN: false }),
)
const specialRawArbitrary = fc.oneof(
  fc.date({ min: new Date(0), max: new Date(4102444800000), noInvalidDate: true }).map((date) => ({ __type: 'Date', iso: date.toISOString() })),
  fc.constant({ __type: 'Date', iso: 'not a date' }),
  fc.constant({ __type: 'Date' }),
  fc.constant({ __type: 'Pointer', className: 'Other', objectId: 'p1' }),
  fc.constant({ __type: 'Pointer', objectId: 'p1' }),
  fc.constant({ __type: 'Object', className: 'Other', objectId: 'o1', label: 'x' }),
  fc.constant({ __type: 'File', name: 'f.png', url: 'https://example.com/f.png' }),
  fc.constant({ __type: 'Relation', className: 'Other' }),
  fc.constant({ __type: 'GeoPoint', latitude: 1.5, longitude: 2.5 }),
  fc.constant({ __type: 'Bytes', base64: 'AAAA' }),
  fc.constant({ __op: 'Delete' }),
)
const { rawValue: rawValueArbitrary } = fc.letrec((tie) => ({
  rawValue: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    leafArbitrary,
    specialRawArbitrary,
    fc.array(tie('rawValue'), { maxLength: 3 }),
    fc.dictionary(fc.constantFrom('a', 'b', 'c', 'd'), tie('rawValue'), { maxKeys: 3 }),
  ),
}))
const serverDataArbitrary = fc.record({
  fields: fc.dictionary(fc.constantFrom(...fieldNames), rawValueArbitrary, { maxKeys: fieldNames.length }),
  hasACL: fc.boolean(),
  createdAt: fc.constantFrom('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'),
})

const localValueArbitrary = fc.oneof(
  leafArbitrary,
  fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 3 }),
  fc.dictionary(fc.constantFrom('a', 'b'), fc.integer({ min: 0, max: 3 }), { maxKeys: 2 }),
  fc.date({ min: new Date(0), max: new Date(4102444800000), noInvalidDate: true }),
)
const operationArbitrary = fc.oneof(
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('mutateInPlace'), name: fc.constantFrom(...fieldNames), how: fc.constantFrom('push', 'pop', 'setFirst', 'setKey', 'deleteKey', 'setDeep', 'setTime'), value: fc.integer({ min: 0, max: 5 }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('set'), name: fc.constantFrom(...fieldNames), value: localValueArbitrary }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('setFromAnotherField'), name: fc.constantFrom(...fieldNames), from: fc.constantFrom(...fieldNames) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('unset'), name: fc.constantFrom(...fieldNames) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('increment'), name: fc.constantFrom('count', 'name'), by: fc.integer({ min: -2, max: 2 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constantFrom('add', 'addUnique', 'remove'), name: fc.constantFrom('tags', 'list', 'mixed'), value: fc.integer({ min: 0, max: 3 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('dottedSet'), name: fc.constantFrom('meta.a', 'deep.b', 'meta.c'), value: fc.integer({ min: 0, max: 3 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('revert'), name: fc.option(fc.constantFrom(...fieldNames), { nil: undefined }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('save'), answer: fc.dictionary(fc.constantFrom(...fieldNames), rawValueArbitrary, { maxKeys: 2 }), isFailed: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('fetch'), serverData: serverDataArbitrary }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('clone') }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('query'), serverData: serverDataArbitrary, select: fc.option(fc.subarray(fieldNames, { minLength: 1, maxLength: 3 }), { nil: undefined }) }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('observe') }) },
)
const scenarioArbitrary = fc.record({
  serverData: serverDataArbitrary,
  select: fc.option(fc.subarray(fieldNames, { minLength: 1, maxLength: 4 }), { nil: undefined }),
  operations: fc.array(operationArbitrary, { maxLength: 12 }),
})

const deepCopy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
const resultJSONOf = ({ fields, hasACL, createdAt }) => ({
  objectId: OBJECT_ID,
  createdAt,
  updatedAt: createdAt,
  ...(hasACL ? { ACL: { '*': { read: true } } } : {}),
  ...deepCopy(fields),
})

// A fake server: each answer is a fresh copy, as parse-server's are.
const installTheFakeServer = () => {
  const server = { queryAnswer: null, fetchAnswer: null, saveAnswer: null, isSaveFailed: false, saveCount: 0 }
  CoreManager.setRESTController({
    ajax: () => Promise.reject(new Error('no HTTP here')),
    request: async (method, path) => {
      if (method === 'GET' && path === `classes/${CLASS_NAME}`) {
        return { results: [deepCopy(server.queryAnswer)] }
      }
      if (method === 'GET' && path === `classes/${CLASS_NAME}/${OBJECT_ID}`) {
        return deepCopy(server.fetchAnswer)
      }
      if (method === 'PUT' && path === `classes/${CLASS_NAME}/${OBJECT_ID}`) {
        if (server.isSaveFailed) {
          throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'save refused')
        }
        server.saveCount += 1
        return { updatedAt: `2026-03-0${Math.min(9, server.saveCount)}T00:00:00.000Z`, ...deepCopy(server.saveAnswer) }
      }
      throw new Error(`unexpected ${method} ${path}`)
    },
  })
  return server
}

const describedValueOf = (value) => {
  try {
    return JSON.stringify(Parse._encode(value, undefined, false))
  } catch (error) {
    return `error: ${error.message}`
  }
}

const attempt = (trace, label, run) => {
  try {
    trace.push([label, run()])
  } catch (error) {
    trace.push([label, `error: ${error.message}`])
  }
}

const observe = (trace, object) => {
  attempt(trace, 'dirty', () => object.dirty())
  attempt(trace, 'dirtyKeys', () => object.dirtyKeys())
  for (const name of fieldNames) {
    attempt(trace, `dirty ${name}`, () => object.dirty(name))
  }
  attempt(trace, 'toJSON', () => JSON.stringify(object.toJSON()))
  attempt(trace, 'saveJSON', () => JSON.stringify(object._getSaveJSON()))
  attempt(trace, 'objectCache', () => JSON.stringify(Object.entries(CoreManager.getObjectStateController().getObjectCache(object._getStateIdentifier()))))
}

const mutateInPlace = (value, how, input) => {
  if (Array.isArray(value)) {
    if (how === 'push') value.push(input)
    else if (how === 'pop') value.pop()
    else value[0] = input
  } else if (value instanceof Date) {
    value.setTime(input * 1000)
  } else if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    if (how === 'deleteKey') delete value.a
    else if (how === 'setDeep' && value.a && typeof value.a === 'object') value.a.b = input
    else value[how === 'setKey' ? 'b' : 'a'] = input
  }
}

// Some sequences leave the SDK waiting for ever, patch or not (a fetch whose answer holds an invalid date throws inside
// the object's task queue, and the saves queued after it never settle). An operation still pending after two seconds is
// recorded as pending, on both sides, and the scenario goes on.
const settledWithin = (promise, milliseconds = 2000) => {
  let timer
  const pending = new Promise((resolve) => { timer = setTimeout(() => resolve('still pending'), milliseconds) })
  return Promise.race([promise.then(() => 'settled'), pending]).finally(() => clearTimeout(timer))
}

const queryOnce = async ({ server, serverData, select }) => {
  server.queryAnswer = resultJSONOf(serverData)
  const query = new Parse.Query(CLASS_NAME)
  if (select) {
    query.select(...select)
  }
  return query.find({ useMasterKey: true }).then((results) => results[0])
}

const runScenario = async (scenarioOfTheProperty) => {
  // Each run gets its own copy: the runs change the values they set in place (a Date's setTime, an array's push).
  const scenario = structuredClone(scenarioOfTheProperty)
  // Every Parse object carries a process-wide creation number (`_objCount`), which an object spread into a plain one
  // (a dotted set on a pointer) shows: the trace keeps it relative to this run's first object, so that two runs
  // creating the same objects compare equal and one creating more does not.
  const firstObjectCount = new Parse.Object('Probe')._objCount
  const trace = []
  const server = installTheFakeServer()
  let object
  try {
    object = await queryOnce({ server, serverData: scenario.serverData, select: scenario.select })
  } catch (error) {
    trace.push(['query', `error: ${error.message}`])
    return trace
  }
  for (const operation of scenario.operations) {
    const label = JSON.stringify(operation).slice(0, 80)
    try {
      switch (operation.kind) {
        case 'mutateInPlace': {
          const value = object.get(operation.name)
          trace.push([label, describedValueOf(value)])
          mutateInPlace(value, operation.how, operation.value)
          break
        }
        case 'set': object.set(operation.name, operation.value); break
        case 'setFromAnotherField': object.set(operation.name, object.get(operation.from)); break
        case 'unset': object.unset(operation.name); break
        case 'increment': object.increment(operation.name, operation.by); break
        case 'add': object.add(operation.name, operation.value); break
        case 'addUnique': object.addUnique(operation.name, operation.value); break
        case 'remove': object.remove(operation.name, operation.value); break
        case 'dottedSet': object.set(operation.name, operation.value); break
        case 'revert': operation.name ? object.revert(operation.name) : object.revert(); break
        case 'save':
          server.saveAnswer = operation.answer
          server.isSaveFailed = operation.isFailed
          if (await settledWithin(object.save(null, { useMasterKey: true })) !== 'settled') {
            trace.push([label, 'still pending'])
          }
          break
        case 'fetch':
          server.fetchAnswer = resultJSONOf(operation.serverData)
          if (await settledWithin(object.fetch({ useMasterKey: true })) !== 'settled') {
            trace.push([label, 'still pending'])
          }
          break
        case 'clone': object = object.clone(); break
        case 'query': object = await queryOnce({ server, serverData: operation.serverData, select: operation.select }); break
        case 'observe': observe(trace, object); break
      }
      trace.push([label, 'done'])
    } catch (error) {
      trace.push([label, `error: ${error.message}`])
    }
  }
  observe(trace, object)
  for (const name of fieldNames) {
    attempt(trace, `get ${name}`, () => describedValueOf(object.get(name)))
  }
  return JSON.parse(JSON.stringify(trace).replace(/\\?"_objCount\\?":(\d+)/g, (match, count) => match.replace(count, String(Number(count) - firstObjectCount))))
}

describe('the lazy fetch snapshot', () => {
  const patch = createTheLazyFetchSnapshot(sdkModules())

  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}))
  afterEach(() => {
    patch.uninstall()
    jest.restoreAllMocks()
  })

  test.each([1, 2, 3, 4, 5])('answers exactly what the SDK answers, over random objects and sequences (seed %i, 400 scenarios)', async (seed) => {
    let lazyFieldCount = 0
    const countTheLazyFields = (scenario) => {
      lazyFieldCount += Object.values(scenario.serverData.fields).filter((raw) => raw && typeof raw === 'object' && isDecodedIntoFreshPlainValues(raw)).length
    }
    await fc.assert(fc.asyncProperty(scenarioArbitrary, async (scenario) => {
      const ofTheSdk = await runScenario(scenario)
      patch.install()
      let withThePatch
      try {
        withThePatch = await runScenario(scenario)
      } finally {
        patch.uninstall()
      }
      expect(withThePatch).toEqual(ofTheSdk)
      countTheLazyFields(scenario)
    }), { numRuns: 400, seed: seed * 104729, timeout: 20000 })
    // The property ran on fields the patch did leave for later, not only on the eager ones.
    expect(lazyFieldCount).toBeGreaterThan(250)
  }, 1200000)

  test('leaves a field for later only when its raw value decodes into fresh plain values', () => {
    expect(isDecodedIntoFreshPlainValues({ a: [1, 'x', null, { b: true }], c: { __type: 'Date', iso: '2026-01-01T00:00:00.000Z' } })).toBe(true)
    for (const raw of [
      { __type: 'Date', iso: 'nope' }, { __type: 'Pointer', className: 'X', objectId: 'y' }, { __type: 'Object', className: 'X', objectId: 'y' },
      { __type: 'File', name: 'f', url: 'u' }, { __type: 'Relation', className: 'X' }, { __type: 'GeoPoint', latitude: 1, longitude: 1 },
      { __type: 'Bytes', base64: '' }, { __op: 'Delete' }, [new Date()], { a: new Date() }, { a: Buffer.from('x') }, { a: 1n },
      Object.create({ inherited: 1 }), [{ a: { __type: 'Pointer', className: 'X', objectId: 'y' } }],
    ]) {
      expect({ raw, isLazy: isDecodedIntoFreshPlainValues(raw) }).toEqual({ raw, isLazy: false })
    }
    let deep = { leaf: 1 }
    for (let level = 0; level < 70; level++) {
      deep = { deep }
    }
    expect(isDecodedIntoFreshPlainValues(deep)).toBe(false)
  })

  test('results asked as JSON are the caller\'s: building objects from them later keeps the eager snapshot', async () => {
    const server = installTheFakeServer()
    server.queryAnswer = resultJSONOf({ fields: { meta: { a: 1 } }, hasACL: false, createdAt: '2026-01-01T00:00:00.000Z' })
    patch.install()
    const [json] = await new Parse.Query(CLASS_NAME).find({ useMasterKey: true, json: true })
    const object = Parse.Object.fromJSON(json)
    json.meta.a = 2 // the caller changes its JSON afterwards
    expect(object.dirty('meta')).toBe(false)
    expect(object.get('meta')).toEqual({ a: 1 })
  })

  test('is off by default, set by the app, and PARSE_LAZY_FETCH_SNAPSHOT wins', async () => {
    expect(engineOptionsFrom({ env: {} }).isLazyFetchSnapshotEnabled).toBe(false)
    expect(engineOptionsFrom({ engineConfiguration: { isLazyFetchSnapshotEnabled: true }, env: {} }).isLazyFetchSnapshotEnabled).toBe(true)
    expect(engineOptionsFrom({ engineConfiguration: { isLazyFetchSnapshotEnabled: true }, env: { PARSE_LAZY_FETCH_SNAPSHOT: '0' } }).isLazyFetchSnapshotEnabled).toBe(false)
    expect(await installTheLazyFetchSnapshot({ isEnabled: false })).toEqual({ isInstalled: false, reason: 'switched off' })
    expect(await installTheLazyFetchSnapshot({ isEnabled: true, loadSdkModules: () => ({}) })).toEqual({ isInstalled: false, reason: 'unknown SDK' })
  })
})
