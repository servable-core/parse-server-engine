// Indexes the engine itself declares, on Parse's system classes: the engine owns those classes, not the app, so
// every Servable app gets them without declaring anything. They are made like the schema's `ensuredIndexes`
// (./index.js): after boot, in the background, one at a time, never dropped, and switched off with the same
// option (`areDeclaredIndexesEnsured`, SERVABLE_ENSURE_DECLARED_INDEXES). They are not part of the schema artifact,
// so they change no app's hash.
//
// _Session._session_token_1 (framework performance audit 2026-11-23, F3; owner's Q1092 a). Every signed-in request
// looks its session up by token (@servable/server userResolver.js, and Parse's own Auth.getAuthForSessionToken),
// and Parse creates no index for it: a collection scan whose cost grows with the number of sessions (0.8 ms for
// 500 locally, production holds only `_id_`). Named as MongoDB names the index Parse's `ensureUniqueness` makes for
// a field (`<storage field>_1`), unique and sparse like those, so an index someone already made by hand or through
// Parse is found identical and left as it is. Session tokens are random (`r:` and 32 characters), so the unique build
// cannot meet duplicates; if it ever did, the index is not made and the log says why (MongoDB code 11000).

export const ENGINE_OWNED_ENSURED_INDEXES = [
  {
    className: '_Session',
    ensuredIndexes: {
      _session_token_1: { keys: { sessionToken: 1 }, isUnique: true },
    },
  },
]

/**
 * The app's classes with the engine's own declarations added: a class the app does not declare is added with only
 * the engine's indexes; on a class it does, the engine's declaration replaces an app's one of the same name (the
 * engine owns these classes).
 * @param {any[] | null | undefined} classes
 * @param {any[]} [engineOwnedClasses]
 * @returns {any[]}
 */
export const withTheEngineOwnedIndexes = (classes, engineOwnedClasses = ENGINE_OWNED_ENSURED_INDEXES) => {
  const merged = (classes || []).map((declaredClass) => declaredClass)
  for (const engineOwnedClass of engineOwnedClasses) {
    const index = merged.findIndex((declaredClass) => declaredClass?.className === engineOwnedClass.className)
    if (index === -1) {
      merged.push({ className: engineOwnedClass.className, ensuredIndexes: { ...engineOwnedClass.ensuredIndexes } })
      continue
    }
    merged[index] = {
      ...merged[index],
      ensuredIndexes: { ...(merged[index].ensuredIndexes || {}), ...engineOwnedClass.ensuredIndexes },
    }
  }
  return merged
}
