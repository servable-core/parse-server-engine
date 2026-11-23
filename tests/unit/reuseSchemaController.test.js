import { jest } from '@jest/globals'
import { installTheSchemaControllerReuse, reuseTheSchemaControllerIn } from '../../src/patches/reuseSchemaController.js'

// Moved from backend/main's app/lib/parse/reuseSchemaController.spec.js with the reuse itself (2026-11-23).

// A fake of Parse Server's DatabaseController and its schema cache. `Config.get()` makes a NEW DatabaseController per call, so every query here asks a new instance.
const makeParse = () => {
    // Like Parse Server's: a NEW array of the cached classes at every call, and an empty one when the cache is cleared.
    const cache = { classes: null, all() { return [...(this.classes || [])] } }
    const adapter = {}
    let built = 0
    class DatabaseController {
        constructor() { this.adapter = adapter }
        async loadSchema() {
            built++
            cache.classes = cache.classes || [{ className: 'A' }, { className: 'B' }]
            return { id: built }
        }
    }
    return { cache, adapter, DatabaseController, built: () => built }
}

describe('reusing the schema controller', () => {
    test('builds one controller per schema cache and hands it to every later query, whichever DatabaseController instance asks', async () => {
        const { cache, DatabaseController, built } = makeParse()
        const reuse = reuseTheSchemaControllerIn({ DatabaseController, schemaCache: cache })
        const first = await new DatabaseController().loadSchema()
        const others = await Promise.all(Array.from({ length: 50 }, () => new DatabaseController().loadSchema()))
        expect(others.every((controller) => controller === first)).toBe(true)
        expect(built()).toBe(1)
        expect(reuse.timesReused()).toBe(50)
    })

    test('builds a new one when the cache holds another list of classes (a class or a field was added) or none (cleared, expired)', async () => {
        const { cache, DatabaseController, built } = makeParse()
        reuseTheSchemaControllerIn({ DatabaseController, schemaCache: cache })
        const first = await new DatabaseController().loadSchema()
        cache.classes = [{ className: 'A' }, { className: 'B' }, { className: 'C' }]
        const second = await new DatabaseController().loadSchema()
        expect(second).not.toBe(first)
        expect(await new DatabaseController().loadSchema()).toBe(second)
        cache.classes = null
        await new DatabaseController().loadSchema()
        expect(built()).toBe(3)
    })

    test('builds a new one when the cache is refilled with new class objects of the same names, and after a minute whatever the cache says', async () => {
        let clock = 0
        const { cache, DatabaseController, built } = makeParse()
        reuseTheSchemaControllerIn({ DatabaseController, schemaCache: cache, now: () => clock })
        await new DatabaseController().loadSchema()
        cache.classes = cache.classes.map((schema) => ({ ...schema }))
        await new DatabaseController().loadSchema()
        expect(built()).toBe(2)
        clock += 59_000
        await new DatabaseController().loadSchema()
        expect(built()).toBe(2)
        clock += 2_000
        await new DatabaseController().loadSchema()
        expect(built()).toBe(3)
    })

    test('always builds a new one when the caller asks to clear the cache', async () => {
        const { cache, DatabaseController, built } = makeParse()
        reuseTheSchemaControllerIn({ DatabaseController, schemaCache: cache })
        await new DatabaseController().loadSchema()
        await new DatabaseController().loadSchema({ clearCache: true })
        expect(built()).toBe(2)
    })

    test('shares nothing between two storage adapters (two apps)', async () => {
        const first = makeParse()
        const reuse = reuseTheSchemaControllerIn({ DatabaseController: first.DatabaseController, schemaCache: first.cache })
        const one = new first.DatabaseController()
        const another = new first.DatabaseController()
        another.adapter = {}
        const a = await one.loadSchema()
        const b = await another.loadSchema()
        expect(a).not.toBe(b)
        expect(reuse.timesReused()).toBe(0)
    })

    test('a schema cache that fails or answers nothing never fails a query: it just builds a controller each time', async () => {
        const { DatabaseController, built } = makeParse()
        reuseTheSchemaControllerIn({ DatabaseController, schemaCache: { all() { throw new Error('cache broken') } } })
        await new DatabaseController().loadSchema()
        await new DatabaseController().loadSchema()
        expect(built()).toBe(2)
    })

    test('keeps nothing when a load fails, and does not hide the error', async () => {
        const { cache, DatabaseController } = makeParse()
        DatabaseController.prototype.loadSchema = jest.fn(async () => { throw new Error('mongo down') })
        reuseTheSchemaControllerIn({ DatabaseController, schemaCache: cache })
        await expect(new DatabaseController().loadSchema()).rejects.toThrow('mongo down')
    })

    test('is installed once when switched on, and never throws', async () => {
        const parse = makeParse()
        const loadSchemaCache = async () => parse.cache
        const loadDatabaseController = async () => parse.DatabaseController
        expect(await installTheSchemaControllerReuse({ isEnabled: true, loadDatabaseController, loadSchemaCache })).toEqual({ isInstalled: true })
        expect(await installTheSchemaControllerReuse({ isEnabled: true, loadDatabaseController, loadSchemaCache })).toEqual({ isInstalled: true, reason: 'already installed' })
        const switchedOff = makeParse()
        expect((await installTheSchemaControllerReuse({ isEnabled: false, loadDatabaseController: async () => switchedOff.DatabaseController, loadSchemaCache })).isInstalled).toBe(false)
        expect(switchedOff.DatabaseController.prototype.loadSchema.isReusingTheSchemaController).toBeUndefined()
        jest.spyOn(console, 'error').mockImplementation(() => {})
        expect((await installTheSchemaControllerReuse({ isEnabled: true, loadDatabaseController: async () => { throw new Error('no module') }, loadSchemaCache })).isInstalled).toBe(false)
        expect((await installTheSchemaControllerReuse({ isEnabled: true, loadDatabaseController: async () => ({}), loadSchemaCache })).isInstalled).toBe(false)
        expect((await installTheSchemaControllerReuse({ isEnabled: true, loadDatabaseController: async () => makeParse().DatabaseController, loadSchemaCache: async () => ({}) })).reason).toBe('no schema cache')
        console.error.mockRestore()
    })
})
