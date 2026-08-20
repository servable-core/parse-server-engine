import 'parse-server'
import { jest } from '@jest/globals'
import Query from '../../src/register/query/index.js'

describe('App.Query master key defaulting', () => {
  beforeEach(() => {
    Parse.initialize('test-app')
    Parse.serverURL = 'http://localhost:1337/parse'
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('find() defaults useMasterKey to true', async () => {
    const spy = jest.spyOn(Parse.Query.prototype, 'find').mockResolvedValue([])

    await new Query('TestObject').find()

    expect(spy).toHaveBeenCalledWith({ useMasterKey: true })
  })

  test('find() does not override an explicit useMasterKey: false', async () => {
    const spy = jest.spyOn(Parse.Query.prototype, 'find').mockResolvedValue([])

    await new Query('TestObject').find({ useMasterKey: false })

    expect(spy).toHaveBeenCalledWith({ useMasterKey: false })
  })

  test('get() passes objectId through and defaults useMasterKey', async () => {
    const spy = jest.spyOn(Parse.Query.prototype, 'get').mockResolvedValue({})

    await new Query('TestObject').get('abc123')

    expect(spy).toHaveBeenCalledWith('abc123', { useMasterKey: true })
  })

  test('first(), count(), each(), map(), reduce(), filter() all default useMasterKey', async () => {
    const firstSpy = jest
      .spyOn(Parse.Query.prototype, 'first')
      .mockResolvedValue(undefined)
    const countSpy = jest
      .spyOn(Parse.Query.prototype, 'count')
      .mockResolvedValue(0)
    const eachSpy = jest
      .spyOn(Parse.Query.prototype, 'each')
      .mockResolvedValue(undefined)
    const mapSpy = jest
      .spyOn(Parse.Query.prototype, 'map')
      .mockResolvedValue([])
    const reduceSpy = jest
      .spyOn(Parse.Query.prototype, 'reduce')
      .mockResolvedValue(0)
    const filterSpy = jest
      .spyOn(Parse.Query.prototype, 'filter')
      .mockResolvedValue([])

    const query = new Query('TestObject')
    const noop = () => {}

    await query.first()
    await query.count()
    await query.each(noop)
    await query.map(noop)
    await query.reduce(noop, 0)
    await query.filter(noop)

    expect(firstSpy).toHaveBeenCalledWith({ useMasterKey: true })
    expect(countSpy).toHaveBeenCalledWith({ useMasterKey: true })
    expect(eachSpy).toHaveBeenCalledWith(noop, { useMasterKey: true })
    expect(mapSpy).toHaveBeenCalledWith(noop, { useMasterKey: true })
    expect(reduceSpy).toHaveBeenCalledWith(noop, 0, { useMasterKey: true })
    expect(filterSpy).toHaveBeenCalledWith(noop, { useMasterKey: true })
  })
})
