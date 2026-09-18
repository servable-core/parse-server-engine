import { jest } from '@jest/globals'
import createTyped from '../../src/register/typed/index.js'

describe('App.Typed', () => {
  test('object() constructs via the given ObjectClass, passing className straight through', () => {
    const ObjectClass = jest.fn().mockImplementation(function (className) { this.className = className })
    const typed = createTyped({ ObjectClass, QueryClass: jest.fn() })

    const instance = typed.object('Reaction')

    expect(ObjectClass).toHaveBeenCalledWith('Reaction')
    expect(instance.className).toBe('Reaction')
  })

  test('query() constructs via the given QueryClass, passing className straight through', () => {
    const QueryClass = jest.fn().mockImplementation(function (className) { this.className = className })
    const typed = createTyped({ ObjectClass: jest.fn(), QueryClass })

    const instance = typed.query('Reaction')

    expect(QueryClass).toHaveBeenCalledWith('Reaction')
    expect(instance.className).toBe('Reaction')
  })

  test('object() and query() are pure passthroughs - same class as Object/Query themselves would use', () => {
    // Not a real ObjectClass/QueryClass, just proving no extra behavior is added: whatever
    // `new ObjectClass(className)` returns is exactly what `.object(className)` returns.
    class FakeObject { constructor(className) { this.className = className; this.isFake = true } }
    const typed = createTyped({ ObjectClass: FakeObject, QueryClass: jest.fn() })

    const instance = typed.object('Reaction')

    expect(instance instanceof FakeObject).toBe(true)
    expect(instance.isFake).toBe(true)
  })
})
