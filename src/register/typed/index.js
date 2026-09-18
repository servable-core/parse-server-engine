// lucide 0.7 (typed-object), PEAKUB DX initiative - see this package's own global.d.ts (the
// ServableClassMap/TypedParseObject/TypedParseQuery/ServableTyped comments) for why this exists
// as a separate, opt-in surface rather than a change to Object/Query themselves: a real survey
// of an app's own call sites found ~235 places that pass a non-literal class name (dominated by
// `new Servable.App.Query(this.className)`, present in every subclass's own class.js) that would
// have become new, 100%-false-positive type errors under a strict Object/Query signature, with
// no way in TypeScript's overload model to keep those working AND catch a bad literal at once.
//
// At runtime this is a pure passthrough - `Servable.App.Typed.object('Reaction')` constructs
// exactly the same instance `new Servable.App.Object('Reaction')` would (same subclass-resolving
// proxy, same class). Only the TYPE differs: calling it through here, with a literal class name,
// gets `.get()`/`.set()`/query methods checked against that class's real generated fields.

/**
 * @param {object} props
 * @param {any} props.ObjectClass - the engine's own Object (see register/object/index.js).
 * @param {any} props.QueryClass - the engine's own Query (see register/query/index.js).
 */
export default ({ ObjectClass, QueryClass }) => ({
  /** @param {string} className */
  object: (className) => new ObjectClass(className),
  /** @param {string} className */
  query: (className) => new QueryClass(className),
})
