import Parse from 'parse/node.js'
import createObject from '../../src/register/object/index.js'

// Real Parse SDK, no mocks: what broke was the SDK's own class map (it registers ParseSession for
// '_Session' at import time), so a fake would hide exactly the thing under test.
const ServableObject = createObject({ Parse })

describe('App.Object built-in Parse classes', () => {
  // backend/main's redeemlogincode.js mints a session exactly like this; it threw
  // "Cannot modify readonly attribute: sessionToken" once the proxy resolved '_Session' to
  // ParseSession, taking magic-code sign-in down in production.
  test("new Object('_Session') can mint a session server-side", () => {
    const session = new ServableObject('_Session')

    expect(() => {
      session.set('sessionToken', 'r:test')
      session.set('user', Parse.User.createWithoutData('u1'))
      session.set('createdWith', { action: 'login', authProvider: 'emailCode' })
      session.set('installationId', 'device-1')
      session.set('expiresAt', new Date())
    }).not.toThrow()
    expect(session.className).toBe('_Session')
    expect(session).not.toBeInstanceOf(Parse.Session)
  })

  test.each(['_Session', '_User', '_Installation', '_Role'])(
    "new Object('%s') keeps Parse's plain-object behaviour",
    (className) => {
      const viaProxy = new ServableObject(className)
      const plain = new Parse.Object(className)
      expect(viaProxy.constructor).toBe(plain.constructor)
      expect(viaProxy.className).toBe(className)
    },
  )

  test('an app/protocol subclass registered for a built-in class is still resolved', () => {
    class AppSession extends Parse.Object {
      constructor() { super('_Session') }
      protocolMethod() { return 'mixin' }
    }
    const originalSession = Parse.Object._getClassMap()._Session
    Parse.Object.registerSubclass('_Session', AppSession)
    try {
      const session = new ServableObject('_Session')
      expect(session).toBeInstanceOf(AppSession)
      expect(session.protocolMethod()).toBe('mixin')
    } finally {
      Parse.Object.registerSubclass('_Session', originalSession)
    }
  })

  test('a registered protocol subclass is still resolved by name', () => {
    class Publication extends Parse.Object {
      constructor() { super('Publication') }
      protocolMethod() { return 'mixin' }
    }
    Parse.Object.registerSubclass('Publication', Publication)

    const publication = new ServableObject('Publication', { name: 'Notabene' })
    expect(publication).toBeInstanceOf(Publication)
    expect(publication.protocolMethod()).toBe('mixin')
    expect(publication.get('name')).toBe('Notabene')
  })
})
