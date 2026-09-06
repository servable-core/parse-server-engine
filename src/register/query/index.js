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

// Mirrors Parse's own module-private _getClassNameFromQueries, including its error, so a
// mismatched compose fails the same way it does today rather than building a nonsense query.
const classNameFromQueries = (queries) => {
  let className = null
  queries.forEach(query => {
    if (!className) {
      className = query.className
    }
    if (className !== query.className) {
      throw new Error('All queries must be for the same class.')
    }
  })
  return className
}

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

  // Parse's own or()/and()/nor() hard-code `new ParseQuery(className)` rather than
  // `new this(...)`, so calling them on this subclass hands back a PLAIN Parse.Query -
  // silently opting the result back out of the master-key defaulting above, which is the
  // one thing this class exists to provide. Nothing errors; the query just quietly returns
  // ACL-filtered results. Overridden here so a composed query stays a Servable query.
  //
  // `new this(...)` (not `new Query(...)`) so a further subclass keeps its own type.
  // _orQuery/_andQuery/_norQuery are inherited prototype methods, so this composes exactly
  // the same query Parse would have built - only the constructor differs.
  static or(...queries) {
    const query = new this(classNameFromQueries(queries))
    query._orQuery(queries)
    return query
  }

  static and(...queries) {
    const query = new this(classNameFromQueries(queries))
    query._andQuery(queries)
    return query
  }

  static nor(...queries) {
    const query = new this(classNameFromQueries(queries))
    query._norQuery(queries)
    return query
  }
}
