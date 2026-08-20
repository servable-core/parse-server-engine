// Servable.App.Query used to be plain Parse.Query, so every read call site
// across every Servable app had to pass { useMasterKey: true } itself
// (protocols/routes run server-side with the app's own master key, not a
// user session, so that's true almost everywhere reads happen). This
// subclass defaults useMasterKey to true on read methods only, so callers
// only need to override it when they actually want ACL-restricted results.
// Object stays plain Parse.Object below - writes (save/destroy/fetch) still
// need it passed explicitly, since Parse.Object's save() signature is too
// varied to patch safely.
const withMasterKey = (options = {}) => ({ useMasterKey: true, ...options })

// Matches register/index.js's own convention of referencing the `Parse`
// global directly rather than importing the `parse` package a second time -
// parse-server's own require of `parse` sets this global as a side effect,
// and a second independent import here would produce a different
// Parse.Query to extend, breaking `instanceof` checks against it elsewhere.
export default class Query extends Parse.Query {
  find(options) {
    return super.find(withMasterKey(options))
  }

  first(options) {
    return super.first(withMasterKey(options))
  }

  get(objectId, options) {
    return super.get(objectId, withMasterKey(options))
  }

  count(options) {
    return super.count(withMasterKey(options))
  }

  // distinct() and aggregate() already force useMasterKey: true internally
  // in Parse.Query (and take no options argument), so there's nothing to
  // wrap here - left unoverridden on purpose.

  each(callback, options) {
    return super.each(callback, withMasterKey(options))
  }

  eachBatch(callback, options) {
    return super.eachBatch(callback, withMasterKey(options))
  }

  map(callback, options) {
    return super.map(callback, withMasterKey(options))
  }

  reduce(callback, initial, options) {
    return super.reduce(callback, initial, withMasterKey(options))
  }

  filter(callback, options) {
    return super.filter(callback, withMasterKey(options))
  }

  // subscribe() (LiveQuery) authenticates via sessionToken, not master key -
  // left unoverridden on purpose.
}
