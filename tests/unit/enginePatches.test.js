import { jest } from '@jest/globals'
import Parse from 'parse/node.js'
import { ENGINE_OPTIONS, engineOptionsFrom, booleanFromEnvironmentValue } from '../../src/options/index.js'
import installTheEnginePatches from '../../src/patches/index.js'

// The engine's options and the patches they switch: what an app gets without writing anything (the defaults of
// backend/main before the move: the fast get off, the schema controller reused, declared indexes made), what the
// app's own choice does, and that an environment variable overrides it when it says something.

describe('the engine options', () => {
  test('are the defaults when the app sets nothing and no variable says anything', () => {
    expect(engineOptionsFrom({ env: {} })).toEqual(Object.fromEntries(Object.entries(ENGINE_OPTIONS).map(([name, { defaultValue }]) => [name, defaultValue])))
    expect(engineOptionsFrom({ env: {} })).toMatchObject({ isFastObjectGetEnabled: false, isSchemaControllerReuseEnabled: true, areDeclaredIndexesEnsured: true })
    expect(engineOptionsFrom({ engineConfiguration: undefined, env: {} })).toMatchObject({ isFastObjectGetEnabled: false, isSchemaControllerReuseEnabled: true, areDeclaredIndexesEnsured: true })
  })

  test('follow the app\'s choice, and only booleans', () => {
    expect(engineOptionsFrom({ engineConfiguration: { isFastObjectGetEnabled: true, isSchemaControllerReuseEnabled: false, areDeclaredIndexesEnsured: false }, env: {} }))
      .toMatchObject({ isFastObjectGetEnabled: true, isSchemaControllerReuseEnabled: false, areDeclaredIndexesEnsured: false })
    expect(engineOptionsFrom({ engineConfiguration: { isFastObjectGetEnabled: 'yes' }, env: {} }).isFastObjectGetEnabled).toBe(false)
  })

  test('are overridden by their environment variable when it says on or off, whatever the app chose', () => {
    const engineConfiguration = { isFastObjectGetEnabled: false, isSchemaControllerReuseEnabled: true, areDeclaredIndexesEnsured: true }
    expect(engineOptionsFrom({ engineConfiguration, env: { PARSE_FAST_OBJECT_GET: '1', PARSE_SCHEMA_CONTROLLER_REUSE: '0', SERVABLE_ENSURE_DECLARED_INDEXES: 'off' } }))
      .toMatchObject({ isFastObjectGetEnabled: true, isSchemaControllerReuseEnabled: false, areDeclaredIndexesEnsured: false })
    expect(engineOptionsFrom({ engineConfiguration, env: { PARSE_FAST_OBJECT_GET: 'maybe', PARSE_SCHEMA_CONTROLLER_REUSE: '' } }))
      .toMatchObject(engineConfiguration)
  })

  test('read on and off the way backend/main read its switches', () => {
    for (const value of ['1', 'true', 'on', ' TRUE ', 'On']) {
      expect(booleanFromEnvironmentValue(value)).toBe(true)
    }
    for (const value of ['0', 'false', 'off', ' OFF ']) {
      expect(booleanFromEnvironmentValue(value)).toBe(false)
    }
    for (const value of [undefined, null, '', '2', 'yes']) {
      expect(booleanFromEnvironmentValue(value)).toBeUndefined()
    }
  })
})

describe('the engine patches', () => {
  test('are installed on the real SDK and the real Parse Server when switched on, and leave a plain object readable', async () => {
    jest.spyOn(console, 'info').mockImplementation(() => {})
    const answer = await installTheEnginePatches({ engineOptions: { isFastObjectGetEnabled: true, isSchemaControllerReuseEnabled: true } })
    console.info.mockRestore()
    expect(answer.fastObjectGet.isInstalled).toBe(true)
    expect(answer.schemaControllerReuse.isInstalled).toBe(true)
    expect(Parse.Object.prototype.get.isTheFastObjectGet).toBe(true)
    // @ts-ignore - parse-server ships no declarations for its compiled lib/ files.
    const DatabaseControllerModule = await import('parse-server/lib/Controllers/DatabaseController.js')
    const DatabaseController = [DatabaseControllerModule.default, DatabaseControllerModule.default?.default].find((candidate) => candidate?.prototype?.loadSchema)
    expect(DatabaseController.prototype.loadSchema.isReusingTheSchemaController).toBe(true)
    const object = Parse.Object.fromJSON({ className: 'Foo', objectId: 'o1', name: 'saved' })
    expect(object.get('name')).toBe('saved')
    object.set('name', 'pending')
    expect(object.get('name')).toBe('pending')
  })
})
