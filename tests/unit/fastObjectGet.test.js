import { jest } from '@jest/globals'
import fc from 'fast-check'
import Parse from 'parse/node.js'
import { fastGetOver, installTheFastObjectGet, installTheFastObjectGetIn } from '../../src/patches/fastObjectGet.js'

// Moved from backend/main's app/lib/parse/fastObjectGet.spec.js with the fast get itself (2026-11-23).
// Invariant I10 of the serializer audit (2026-11-23): for any state of a Parse object, the fast `get` answers what the SDK's
// `get` answers. Checked against the real SDK (parse 6.1.1), with the server's single-instance mode off, over random objects
// (fields of every type) and random states (fresh, fetched, pending set / unset / increment / add / addUnique / remove /
// relation op / dotted set, a save in flight, reverted, cleared).

Parse.Object.disableSingleInstance()
const getOfTheSdk = Parse.Object.prototype.get
const fastGet = fastGetOver(getOfTheSdk)

const fieldNames = ['name', 'count', 'flag', 'tags', 'nested', 'when', 'owner', 'rel', 'nothing', 'zero', 'empty', 'list', 'geo', 'file']
// Names asked besides the fields: unknown ones, Object.prototype's, dotted, the SDK's own.
const askedNames = [...fieldNames, 'missing', 'constructor', 'toString', '__proto__', 'hasOwnProperty', 'nested.a', 'nested.b.c', 'objectId', 'createdAt', 'updatedAt', 'ACL', 'id', '']

const serverValueArbitrary = fc.oneof(
    fc.constant(null),
    fc.constant(false),
    fc.constant(true),
    fc.constant(0),
    fc.constant(''),
    fc.integer(),
    fc.double({ noNaN: true }),
    fc.string(),
    fc.array(fc.oneof(fc.integer(), fc.string()), { maxLength: 4 }),
    fc.dictionary(fc.constantFrom('a', 'b', 'c'), fc.oneof(fc.integer(), fc.string(), fc.constant(null)), { maxKeys: 3 }),
    fc.date({ min: new Date(0), max: new Date(4102444800000), noInvalidDate: true }).map((date) => ({ __type: 'Date', iso: date.toISOString() })),
    fc.constantFrom('p1', 'p2').map((objectId) => ({ __type: 'Pointer', className: 'Bar', objectId })),
    fc.constant({ __type: 'Relation', className: 'Bar' }),
    fc.constant({ __type: 'GeoPoint', latitude: 1.5, longitude: 2.5 }),
    fc.constant({ __type: 'File', name: 'f.png', url: 'https://example.com/f.png' }),
)

const serverDataArbitrary = fc.dictionary(fc.constantFrom(...fieldNames), serverValueArbitrary, { maxKeys: fieldNames.length })

const operationArbitrary = fc.oneof(
    fc.record({ kind: fc.constant('set'), name: fc.constantFrom(...fieldNames), value: fc.oneof(fc.integer(), fc.string(), fc.constant(null), fc.constant(false), fc.constant(0), fc.array(fc.integer(), { maxLength: 3 })) }),
    fc.record({ kind: fc.constant('unset'), name: fc.constantFrom(...fieldNames) }),
    fc.record({ kind: fc.constant('increment'), name: fc.constantFrom('count', 'zero', 'fresh'), by: fc.integer({ min: -3, max: 3 }) }),
    fc.record({ kind: fc.constantFrom('add', 'addUnique', 'remove'), name: fc.constantFrom('tags', 'list', 'freshList'), value: fc.oneof(fc.integer({ min: 0, max: 3 }), fc.constantFrom('x', 'y')) }),
    fc.record({ kind: fc.constant('relation'), target: fc.constantFrom('b1', 'b2') }),
    fc.record({ kind: fc.constant('dotted'), name: fc.constantFrom('nested.a', 'nested.b'), value: fc.oneof(fc.integer(), fc.string()) }),
    fc.record({ kind: fc.constant('saveInFlight') }),
    fc.record({ kind: fc.constant('revert') }),
    fc.record({ kind: fc.constant('serverAnswer'), data: serverDataArbitrary }),
)

const objectStateArbitrary = fc.record({
    kind: fc.constantFrom('fresh', 'fetched', 'pointer'),
    serverData: serverDataArbitrary,
    operations: fc.array(operationArbitrary, { maxLength: 6 }),
})

const applyOperation = (object, operation) => {
    try {
        switch (operation.kind) {
            case 'set': object.set(operation.name, operation.value); break
            case 'unset': object.unset(operation.name); break
            case 'increment': object.increment(operation.name, operation.by); break
            case 'add': object.add(operation.name, operation.value); break
            case 'addUnique': object.addUnique(operation.name, operation.value); break
            case 'remove': object.remove(operation.name, operation.value); break
            case 'relation': object.relation('rel').add(Parse.Object.fromJSON({ className: 'Bar', objectId: operation.target })); break
            case 'dotted': object.set(operation.name, operation.value); break
            case 'saveInFlight': object._pushPendingState(); break
            case 'revert': object.revert(); break
            case 'serverAnswer': object._finishFetch({ objectId: object.id || 'o1', ...operation.data }); break
            default: break
        }
    } catch (error) {
        // The SDK refused the operation (an add on a number...): the object keeps the state it had, which is still compared.
    }
}

const objectInState = ({ kind, serverData, operations }) => {
    const object = kind === 'fresh'
        ? new Parse.Object('Foo')
        : kind === 'pointer'
            ? Parse.Object.fromJSON({ __type: 'Pointer', className: 'Foo', objectId: 'o1' })
            : Parse.Object.fromJSON({ className: 'Foo', objectId: 'o1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', ...serverData })
    if (kind === 'fresh') {
        Object.entries(serverData).forEach(([name, value]) => applyOperation(object, { kind: 'set', name, value: value?.__type ? null : value }))
    }
    operations.forEach((operation) => applyOperation(object, operation))
    return object
}

const outcomeOf = (read) => {
    try {
        return { value: read(), errorMessage: null }
    } catch (error) {
        return { value: undefined, errorMessage: error.message }
    }
}

const isWithoutPendingChange = (object) => object._getPendingOps().every((operations) => Object.keys(operations).length === 0)

describe('the fast object get', () => {
    // Five fixed seeds of 2000 runs each, so a run is repeatable and a failure names its seed; and one free seed.
    test.each([1, 2, 3, 4, 5, undefined])('answers what the SDK\'s get answers, for any object in any state (property, 2000 runs, seed %s)', (seed) => {
        let plainStates = 0
        let changedStates = 0
        fc.assert(fc.property(objectStateArbitrary, (state) => {
            const object = objectInState(state)
            const isPlain = isWithoutPendingChange(object)
            isPlain ? plainStates++ : changedStates++
            for (const name of askedNames) {
                // The SDK's own get can throw (an add over a value that became a file): the fast one must throw the same.
                const expected = outcomeOf(() => getOfTheSdk.call(object, name))
                const answered = outcomeOf(() => fastGet.call(object, name))
                expect(answered.errorMessage).toBe(expected.errorMessage)
                if (isPlain) {
                    // The same value, the very same reference: nothing is copied either way.
                    expect(Object.is(answered.value, expected.value)).toBe(true)
                } else {
                    expect(answered.value).toEqual(expected.value)
                }
            }
        }), { numRuns: 2000, ...(seed === undefined ? {} : { seed }) })
        // Both paths were walked many times.
        expect(plainStates).toBeGreaterThan(200)
        expect(changedStates).toBeGreaterThan(200)
    })

    test('reads live: a value changed by a save answer or a set is seen at once, and the old one never comes back', () => {
        const object = Parse.Object.fromJSON({ className: 'Foo', objectId: 'o1', name: 'old', count: 1 })
        expect(fastGet.call(object, 'name')).toBe('old')
        object.set('name', 'pending')
        expect(fastGet.call(object, 'name')).toBe('pending')
        object.revert()
        expect(fastGet.call(object, 'name')).toBe('old')
        object.increment('count', 2)
        expect(fastGet.call(object, 'count')).toBe(3)
        object._finishFetch({ objectId: 'o1', name: 'saved', count: 3 })
        object._clearPendingOps()
        expect(fastGet.call(object, 'name')).toBe('saved')
        expect(fastGet.call(object, 'count')).toBe(3)
    })

    test('falls back to the SDK when the object cannot tell its state', () => {
        const odd = { _getPendingOps: () => { throw new Error('no state') }, _getServerData: () => ({}) }
        const fallback = fastGetOver(function () { return 'from the SDK' })
        expect(fallback.call(odd, 'name')).toBe('from the SDK')
        expect(fallback.call({ _getPendingOps: () => [{}], _getServerData: () => Object.create(null) }, 'name')).toBe('from the SDK')
        expect(fallback.call({ _getPendingOps: () => null, _getServerData: () => ({ name: 'x' }) }, 'name')).toBe('from the SDK')
        expect(fallback.call({ _getPendingOps: () => [{}], _getServerData: () => ({ name: 'x' }) }, 'name')).toBe('x')
        expect(fallback.call({ _getPendingOps: () => [{}], _getServerData: () => ({}) }, 42)).toBe('from the SDK')
    })

    test('is installed on the prototype once, and put back on restore', () => {
        class FakeObject { get(attr) { return `sdk:${attr}` } _getPendingOps() { return [{ name: {} }] } _getServerData() { return {} } }
        const first = installTheFastObjectGetIn({ ParseObject: FakeObject })
        expect(FakeObject.prototype.get.isTheFastObjectGet).toBe(true)
        expect(installTheFastObjectGetIn({ ParseObject: FakeObject }).reason).toBe('already installed')
        expect(new FakeObject().get('name')).toBe('sdk:name')
        first.restore()
        expect(FakeObject.prototype.get.isTheFastObjectGet).toBeUndefined()
    })

    test('is installed only when switched on, and never throws', async () => {
        let isLoaded = false
        const loadParseObject = async () => { isLoaded = true; return class { get() {} _getPendingOps() {} _getServerData() {} } }
        expect((await installTheFastObjectGet({ isEnabled: false, loadParseObject })).isInstalled).toBe(false)
        expect(isLoaded).toBe(false)
        jest.spyOn(console, 'info').mockImplementation(() => {})
        expect((await installTheFastObjectGet({ isEnabled: true, loadParseObject })).isInstalled).toBe(true)
        console.info.mockRestore()
        jest.spyOn(console, 'error').mockImplementation(() => {})
        expect((await installTheFastObjectGet({ isEnabled: true, loadParseObject: async () => class {} })).reason).toBe('unknown SDK')
        expect((await installTheFastObjectGet({ isEnabled: true, loadParseObject: async () => { throw new Error('no SDK') } })).isInstalled).toBe(false)
        console.error.mockRestore()
    })
})
