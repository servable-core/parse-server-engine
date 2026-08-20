import 'parse-server'
import { jest } from '@jest/globals'

// Replace the network-calling originals before the patch captures them, so
// "original" always means these mocks, never a real HTTP call.
const originalSave = jest.fn().mockResolvedValue(undefined)
const originalDestroy = jest.fn().mockResolvedValue(undefined)
const originalSaveAll = jest.fn().mockResolvedValue([])
const originalDestroyAll = jest.fn().mockResolvedValue([])

Parse.Object.prototype.save = originalSave
Parse.Object.prototype.destroy = originalDestroy
Parse.Object.saveAll = originalSaveAll
Parse.Object.destroyAll = originalDestroyAll

// detectReplicaSet.js does a real MongoDB connection - controlled explicitly
// here instead of relying on ENGINE_DATABASE_URI being unset in the test env.
const isConfirmedStandaloneMongo = jest.fn().mockResolvedValue(false)
jest.unstable_mockModule(
  '../../src/register/transaction/detectReplicaSet.js',
  () => ({
    __esModule: true,
    default: (...args) => isConfirmedStandaloneMongo(...args)
  })
)

const { default: createTransaction } = await import(
  '../../src/register/transaction/index.js'
)
const Transaction = createTransaction({ Parse })

describe('App.Transaction', () => {
  beforeEach(() => {
    originalSave.mockClear()
    originalDestroy.mockClear()
    originalSaveAll.mockClear()
    originalDestroyAll.mockClear()
    isConfirmedStandaloneMongo.mockClear()
    isConfirmedStandaloneMongo.mockResolvedValue(false)
  })

  test('a plain save() with no transaction option passes straight through', async () => {
    const obj = new Parse.Object('TestObject')

    await obj.save({ name: 'direct' })

    expect(originalSave).toHaveBeenCalledTimes(1)
    expect(originalSaveAll).not.toHaveBeenCalled()
  })

  test('save() with a transaction defers instead of calling the original save', async () => {
    const tx = new Transaction()
    const obj = new Parse.Object('TestObject')

    const result = await obj.save({ name: 'deferred' }, { transaction: tx })

    expect(originalSave).not.toHaveBeenCalled()
    expect(result).toBe(obj)
    expect(obj.get('name')).toBe('deferred')
  })

  test('commit() sends every deferred save as one real saveAll(..., { transaction: true }) call', async () => {
    const tx = new Transaction({ useMasterKey: true })
    const objA = new Parse.Object('TestObject')
    const objB = new Parse.Object('TestObject')

    await objA.save({ name: 'a' }, { transaction: tx })
    await objB.save({ name: 'b' }, { transaction: tx })
    const outcome = await tx.commit()

    expect(originalSaveAll).toHaveBeenCalledTimes(1)
    expect(originalSaveAll).toHaveBeenCalledWith([objA, objB], {
      useMasterKey: true,
      transaction: true
    })
    expect(outcome).toEqual({
      token: tx.token,
      writes: 2,
      state: 'committed',
      mode: 'deferred-batch-transaction'
    })
  })

  test('commit() sends every deferred destroy as one real destroyAll(..., { transaction: true }) call', async () => {
    const tx = new Transaction()
    const objA = new Parse.Object('TestObject')
    const objB = new Parse.Object('TestObject')

    await objA.destroy({ transaction: tx })
    await objB.destroy({ transaction: tx })
    await tx.commit()

    expect(originalDestroyAll).toHaveBeenCalledTimes(1)
    expect(originalDestroyAll).toHaveBeenCalledWith([objA, objB], {
      transaction: true
    })
  })

  test('Parse.Object.saveAll() with a transaction defers the whole batch', async () => {
    const tx = new Transaction()
    const objects = [
      new Parse.Object('TestObject'),
      new Parse.Object('TestObject')
    ]

    const result = await Parse.Object.saveAll(objects, { transaction: tx })

    expect(originalSaveAll).not.toHaveBeenCalled()
    expect(result).toBe(objects)

    await tx.commit()
    expect(originalSaveAll).toHaveBeenCalledTimes(1)
    expect(originalSaveAll).toHaveBeenCalledWith(objects, { transaction: true })
  })

  test('mixing a save and a destroy on the same transaction throws immediately', async () => {
    const tx = new Transaction()
    const obj = new Parse.Object('TestObject')

    await obj.save({ name: 'x' }, { transaction: tx })

    await expect(
      new Parse.Object('TestObject').destroy({ transaction: tx })
    ).rejects.toThrow(/only support one write kind/)

    // Nothing should have been sent - the failed enqueue didn't touch state.
    expect(originalSave).not.toHaveBeenCalled()
    expect(originalDestroy).not.toHaveBeenCalled()
  })

  test('commit() with nothing queued succeeds trivially', async () => {
    const tx = new Transaction()

    const outcome = await tx.commit()

    expect(originalSaveAll).not.toHaveBeenCalled()
    expect(originalDestroyAll).not.toHaveBeenCalled()
    expect(outcome.writes).toBe(0)
    expect(outcome.state).toBe('committed')
  })

  test('rollback() discards deferred writes without sending anything', async () => {
    const tx = new Transaction()
    const obj = new Parse.Object('TestObject')

    await obj.save({ name: 'x' }, { transaction: tx })
    const outcome = await tx.rollback()

    expect(originalSave).not.toHaveBeenCalled()
    expect(originalSaveAll).not.toHaveBeenCalled()
    expect(outcome).toEqual({
      token: tx.token,
      discarded: 1,
      state: 'aborted',
      mode: 'deferred-batch-transaction'
    })
  })

  test('commit() on an already-committed transaction throws', async () => {
    const tx = new Transaction()
    await tx.commit()

    await expect(tx.commit()).rejects.toThrow(
      'Transaction is already committed'
    )
  })

  test('a failed commit is rethrown unchanged when standalone MongoDB is not confirmed', async () => {
    isConfirmedStandaloneMongo.mockResolvedValue(false)
    originalSaveAll.mockRejectedValueOnce(new Error('write conflict'))
    const tx = new Transaction()
    const obj = new Parse.Object('TestObject')
    await obj.save({ name: 'x' }, { transaction: tx })

    await expect(tx.commit()).rejects.toThrow('write conflict')
    expect(tx.state).toBe('failed')
  })

  test('commit() falls back to sequential writes when standalone MongoDB is confirmed', async () => {
    isConfirmedStandaloneMongo.mockResolvedValue(true)
    originalSaveAll.mockRejectedValueOnce(new Error('Internal server error.'))
    const consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => {})

    const tx = new Transaction({ useMasterKey: true })
    const objA = new Parse.Object('TestObject')
    const objB = new Parse.Object('TestObject')
    await objA.save({ name: 'a' }, { transaction: tx })
    await objB.save({ name: 'b' }, { transaction: tx })

    const outcome = await tx.commit()

    expect(originalSaveAll).toHaveBeenCalledTimes(1)
    expect(originalSave).toHaveBeenCalledTimes(2)
    expect(originalSave).toHaveBeenNthCalledWith(1, null, {
      useMasterKey: true
    })
    expect(originalSave).toHaveBeenNthCalledWith(2, null, {
      useMasterKey: true
    })
    expect(outcome).toEqual({
      token: tx.token,
      writes: 2,
      state: 'committed',
      mode: 'sequential-fallback'
    })
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1)
    expect(consoleWarnSpy.mock.calls[0][0]).toMatch(
      /standalone, not a replica set/
    )

    consoleWarnSpy.mockRestore()
  })

  test('commit() falls back to sequential destroys when standalone MongoDB is confirmed', async () => {
    isConfirmedStandaloneMongo.mockResolvedValue(true)
    originalDestroyAll.mockRejectedValueOnce(
      new Error('Internal server error.')
    )
    const consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => {})

    const tx = new Transaction()
    const objA = new Parse.Object('TestObject')
    const objB = new Parse.Object('TestObject')
    await objA.destroy({ transaction: tx })
    await objB.destroy({ transaction: tx })

    const outcome = await tx.commit()

    expect(originalDestroyAll).toHaveBeenCalledTimes(1)
    expect(originalDestroy).toHaveBeenCalledTimes(2)
    expect(outcome.mode).toBe('sequential-fallback')
    expect(outcome.writes).toBe(2)

    consoleWarnSpy.mockRestore()
  })
})
