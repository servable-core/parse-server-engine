// @ts-ignore - parse-server ships no declarations for its compiled lib/ files.
import InMemoryCacheAdapterModule from 'parse-server/lib/Adapters/Cache/InMemoryCacheAdapter.js'
// @ts-ignore
import CacheControllerModule from 'parse-server/lib/Controllers/CacheController.js'
import { cacheKeyWithoutSessionToken, withSessionTokensHashedInKeys } from '../../src/setConfigurations/adapters/sessionKeyHashing.js'
import { hashedSessionTokenOf } from '../../src/register/route/cache/lib/hashSessionToken.js'

// Parse's own session cache (`<appId>:user:<token>`) never writes a token into a key (F9, Q1095 a), and Parse still
// finds, replaces and drops its entries: driven through Parse's real CacheController and a real Parse adapter class.

const InMemoryCacheAdapter = InMemoryCacheAdapterModule.InMemoryCacheAdapter ?? InMemoryCacheAdapterModule.default ?? InMemoryCacheAdapterModule
const CacheController = CacheControllerModule.CacheController ?? CacheControllerModule.default ?? CacheControllerModule

const TOKEN = 'r:0123456789abcdef0123456789abcdef'

describe('Parse cache keys without session tokens', () => {
  test('a user key gets the digest; other keys are left as they are', () => {
    expect(cacheKeyWithoutSessionToken(`app:user:${TOKEN}`)).toBe(`app:user:${hashedSessionTokenOf(TOKEN)}`)
    expect(cacheKeyWithoutSessionToken('app:role:userId1')).toBe('app:role:userId1')
    expect(cacheKeyWithoutSessionToken('app:user:')).toBe('app:user:')
    expect(cacheKeyWithoutSessionToken(42)).toBe(42)
  })

  test('Parse\'s controller puts, gets and deletes through it, and the stored keys hold no token', async () => {
    const Adapter = withSessionTokensHashedInKeys(InMemoryCacheAdapter)
    const adapter = new Adapter({ ttl: 60000 })
    expect(adapter).toBeInstanceOf(InMemoryCacheAdapter)
    const controller = new CacheController(adapter, 'app')
    await controller.user.put(TOKEN, { objectId: 'u1' })
    expect(await controller.user.get(TOKEN)).toEqual({ objectId: 'u1' })
    const storedKeys = [...adapter.cache.cache.keys()]
    expect(storedKeys).toEqual([`app:user:${hashedSessionTokenOf(TOKEN)}`])
    expect(storedKeys.join(' ')).not.toContain(TOKEN.slice(2))
    await controller.user.del(TOKEN)
    expect(await controller.user.get(TOKEN)).toBeNull()
    await controller.role.put('u1', ['admin'])
    expect([...adapter.cache.cache.keys()]).toEqual(['app:role:u1'])
  })

  test('a value that is not a class is given back as it is', () => {
    expect(withSessionTokensHashedInKeys(undefined)).toBeUndefined()
  })
})
