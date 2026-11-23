// @ts-ignore - parse-server ships no declarations for its compiled lib/ files.
import MongoTransformModule from 'parse-server/lib/Adapters/Storage/Mongo/MongoTransform.js'
import { storageIndexFrom } from '../../src/indexes/storageIndex.js'
import { ENGINE_OWNED_ENSURED_INDEXES, withTheEngineOwnedIndexes } from '../../src/indexes/engineOwnedIndexes.js'

// The engine's own index on Parse's `_Session` (F3, Q1092 a): what reaches MongoDB is `{ _session_token: 1 }`, named
// `_session_token_1`, unique and sparse, as Parse's `ensureUniqueness` would make it; and it rides with the app's
// declarations without changing them.

const transformKey = (MongoTransformModule.default ?? MongoTransformModule).transformKey

describe('engine-owned ensured indexes', () => {
  test('_Session gets its token index, as Parse would name and make it', () => {
    const [session] = ENGINE_OWNED_ENSURED_INDEXES
    expect(session.className).toBe('_Session')
    const [[name, declaration]] = Object.entries(session.ensuredIndexes)
    const storageIndex = storageIndexFrom({ className: '_Session', name, declaration, declaredFields: {}, transformKey })
    expect(storageIndex.keys).toEqual({ _session_token: 1 })
    expect(storageIndex.options).toEqual(expect.objectContaining({ name: '_session_token_1', unique: true, sparse: true, background: true }))
  })

  test('are added to the app\'s classes; the app\'s own declarations are kept', () => {
    const appClasses = [
      { className: 'A', ensuredIndexes: { a_1: { keys: { a: 1 } } } },
      { className: '_Session', fields: { x: { type: 'String' } }, ensuredIndexes: { x_1: { keys: { x: 1 } } } },
    ]
    const merged = withTheEngineOwnedIndexes(appClasses)
    expect(merged[0]).toBe(appClasses[0])
    expect(merged[1]).toEqual({
      className: '_Session',
      fields: { x: { type: 'String' } },
      ensuredIndexes: { x_1: { keys: { x: 1 } }, _session_token_1: { keys: { sessionToken: 1 }, isUnique: true } },
    })
    // The app's own list is not changed.
    expect(appClasses[1].ensuredIndexes).toEqual({ x_1: { keys: { x: 1 } } })
    expect(withTheEngineOwnedIndexes(null)).toEqual(ENGINE_OWNED_ENSURED_INDEXES)
  })
})
