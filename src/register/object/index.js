// Servable.App.Object - Parse.Object with one behaviour changed: constructing by class
// name resolves the registered subclass, so protocol mixins are present from birth.
//
// Why this exists. Parse has two ways to get an object of a class, and only one of them
// consults the subclass registry:
//
//   new Parse.Object('Publication')      -> a plain ParseObject. The constructor just
//                                           assigns this.className; it never looks at the
//                                           class map, so NONE of the protocol mixins
//                                           registered by the server's registerClass.js
//                                           (Parse.Object.registerSubclass) are on it.
//   ParseObject.fromJSON({...})          -> classMap[className], i.e. the registered
//                                           subclass, mixins and all. This is what Query
//                                           results and fetch() go through.
//
// That asymmetry is why consumer code kept having to re-fetch an object it had just
// created before it could call protocol methods on it ("save, then query it back to get
// the mixins"). The re-fetch is a real cost - an extra round trip, and it throws away
// correct in-memory state for a freshly-read copy - and it is easy to forget, which
// surfaces as "x.someProtocolMethod is not a function" on a brand-new object.
//
// A Proxy rather than a wrapper function: every static on Parse.Object must keep working
// unchanged through this (extend, registerSubclass, saveAll/destroyAll - including the
// transaction module's monkey-patched versions, which mutate Parse.Object itself and are
// therefore picked up by forwarding - fromJSON, createWithoutData, ...), and
// `x instanceof Servable.App.Object` must keep holding for subclass instances. A Proxy
// forwards all of that by default; only construction is intercepted.
//
// Deliberately NOT implemented with Parse.Object.extend(className): extend() ends with an
// unconditional `classMap[className] = subclass`, so calling it for a class that has no
// registered subclass would silently register a fresh empty one - a typo'd class name
// would permanently pollute the registry. The class map is read here instead, and an
// unregistered class simply falls through to Parse's own behaviour.

const classNameOf = (first) => {
  if (typeof first === 'string') {
    return first
  }
  // Parse also accepts new Parse.Object({ className, ...attributes }).
  if (first && typeof first === 'object' && typeof first.className === 'string') {
    return first.className
  }
  return null
}

// The subclasses the Parse SDK registers for its own built-in classes, at import time, before any
// app or protocol has registered anything. They are client-SDK types, not protocol mixins, and
// ParseSession in particular declares createdWith/expiresAt/installationId/restricted/
// sessionToken/user read-only - so resolving `new Servable.App.Object('_Session')` to it made
// every server-side session mint throw "Cannot modify readonly attribute: sessionToken" on its
// first set(). That broke backend/main's magic-code sign-in in production from the day this
// proxy shipped (PEAKUB, 2026-09-23). Constructing one of these by name therefore keeps Parse's
// own plain-object behaviour, exactly as before the proxy existed; an app or protocol that
// registers its OWN subclass for one of these classes replaces the SDK's entry in the class map
// and is resolved as usual.
const parseSdkBuiltInSubclassesOf = (Parse) => [Parse.Session, Parse.User, Parse.Installation, Parse.Role]
  .filter(Boolean)

const registeredSubclassFor = ({ Parse, className }) => {
  if (!className || typeof Parse.Object._getClassMap !== 'function') {
    return null
  }
  // Live reference to Parse's own map, so a class registered later in launch is picked up
  // without any cache to invalidate here.
  const Subclass = Parse.Object._getClassMap()[className] || null
  if (Subclass && parseSdkBuiltInSubclassesOf(Parse).includes(Subclass)) {
    return null
  }
  return Subclass
}

export default ({ Parse }) => {
  const proxy = new Proxy(Parse.Object, {
    construct(target, args, newTarget) {
      // `class Publication extends Servable.App.Object` - the caller already has a
      // concrete constructor (and this is the path every registered class itself takes
      // on its own `super(className)` call), leave it entirely alone.
      if (newTarget !== proxy) {
        return Reflect.construct(target, args, newTarget)
      }

      const [first, second] = args
      const className = classNameOf(first)
      const Subclass = registeredSubclassFor({ Parse, className })

      // No subclass registered (yet) for this class, or the registered "subclass" IS
      // Parse.Object - nothing to gain, behave exactly as before.
      if (!Subclass || Subclass === target) {
        return Reflect.construct(target, args, newTarget)
      }

      // Normalize Parse's two call shapes - (className, attributes, options) and
      // ({ className, ...attributes }, options) - into one pair.
      let attributes
      let options
      if (typeof first === 'string') {
        attributes = second
        options = args[2]
      } else {
        const { className: _ignored, ...rest } = first
        attributes = rest
        options = second
      }

      // Constructed with no arguments, then attributes applied - NOT passed to the
      // constructor. Registered classes in this codebase are zero-arg ES classes that
      // hardcode their own class name (`constructor() { super('Publication') }`), so
      // anything passed positionally would be silently dropped. Setting afterwards works
      // for those and equally for a Parse.Object.extend()-generated subclass, whose
      // constructor does take (attributes, options).
      const instance = Reflect.construct(Subclass, [])

      if (attributes && typeof attributes === 'object' && Object.keys(attributes).length) {
        try {
          instance.set(attributes, options)
        } catch (_) {
          // Same failure mode as Parse's own constructor.
          throw new Error("Can't create an invalid Parse Object")
        }
      }

      return instance
    }
  })

  return proxy
}
