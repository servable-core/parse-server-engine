import fs from 'fs'

/**
 * @param {object} props
 * @param {string} props.objectId
 * @param {string} props.className
 * @param {boolean} [props.useMasterKey]
 */
export const getOnePlain = async props => {
  const { objectId, className, useMasterKey = false } = props;
  const query = new Servable.App.Query(className);
  query.equalTo("objectId", objectId);

  return query.first({ useMasterKey });
};

/**
 * @param {object} props
 * @param {any} props.query - a Parse.Query, mutated in place (limit/skip/sort applied).
 * @param {{ sort?: 'asc' | 'desc', limit?: number, skip?: number, page?: number, withCount?: boolean }} props.options
 */
export const formatQuery = props => {
  const { options, query } = props;
  const { sort, limit = 100, skip = 0, page = 0, withCount = false } = options;
  query.limit(limit);
  if (page) {
    query.skip(page * limit);
  } else {
    query.skip(skip);
  }

  if (withCount) {
    query.withCount();
  }

  switch (sort) {
    case "desc":
      query.descending("createdAt");
      break;
    default:
      query.ascending("createdAt");
      break;
  }
};

/**
 * @param {object} [props]
 * @param {string} [props.objectId]
 * @param {string} [props.className]
 * @param {string | string[]} [props.include]
 */
export const getOneGeneric = async ({ objectId, className, include } = {}) => {
  const query = new Servable.App.Query(className);
  include && query.include(include);
  query.equalTo("objectId", objectId);
  return query.first({ useMasterKey: true });
};

/**
 * @param {object} props
 * @param {any} props.query - a Parse.Query, paged through via skip/limit until exhausted.
 * @param {number} [props.batchSize]
 * @param {(item: any) => any} props.action - run over every result, one batch at a time.
 */
export const performBatchOnQuery = async ({
  query,
  batchSize = 100,
  action
}) => {
  const count = await query.count({ useMasterKey: true });
  // Was `parseInt(count / batchSize)` - parseInt takes a string; passing it a number worked
  // only because JS coerces it via toString() first, which is what this actually meant to do
  // with Math.floor() instead (found via checkJs, lucide/PEAKUB DX initiative).
  const expectedLoops = Math.floor(count / batchSize);
  let currentBatchResultsLength = 0;
  let loops = 0;

  do {
    query.skip(batchSize * loops);
    query.limit(batchSize);
    const items = await query.find({ useMasterKey: true });
    if (items && items.length) {
      await Promise.all(items.map(action));
    }

    currentBatchResultsLength = items.length;
    loops++;
  } while (loops < expectedLoops || currentBatchResultsLength === batchSize);
};

/**
 * @param {object} [props]
 * @param {any} [props.object] - either a live Parse.Object or a bare objectId string.
 * @param {string} [props.className] - required when `object` is a bare objectId string.
 * @param {boolean} [props.forceFetch] - re-fetch even when `object` is already a live instance.
 * @param {string[]} [props.includes]
 * @param {string[]} [props.excludes]
 * @param {boolean} [props.useMasterKey]
 */
export const fetchObjectIfNeeded = async ({
  object,
  className,
  forceFetch = false,
  includes = [],
  excludes = [],
  useMasterKey = false
} = {}) => {
  if (typeof object === "string") {
    return fetchObject({
      objectId: object,
      className,
      includes,
      excludes,
      useMasterKey
    });
  }

  if (forceFetch) {
    return fetchObject({
      objectId: object.id,
      className,
      includes,
      excludes,
      useMasterKey
    });
  }

  return object;
};

/**
 * @param {object} [props]
 * @param {string} [props.objectId]
 * @param {string} [props.className]
 * @param {boolean} [props.forceFetch] - accepted for call-shape parity with `fetchObjectIfNeeded`;
 *   unused - this function always fetches.
 * @param {string[]} [props.includes]
 * @param {string[]} [props.excludes]
 * @param {boolean} [props.useMasterKey]
 */
export const fetchObject = async ({
  objectId,
  className,
  forceFetch,
  includes = [],
  excludes = [],
  useMasterKey = false
} = {}) => {
  const query = new Servable.App.Query(className);
  query.equalTo("objectId", objectId);
  query.include(includes);
  query.exclude(excludes);

  return query.first({ useMasterKey });
};

/**
 * @param {object} [props]
 * @param {any} [props.query] - a Parse.Query; NOT re-usable after this call (`.limit()` mutates
 *   it in place, and Parse.Query has no `.clone()` call here to guard against that).
 * @param {number} [props.limitPerBatch]
 * @returns {Promise<number>} the number of rows destroyed in this one batch.
 */
export const destroyRowsWithQuery = async ({ query, limitPerBatch } = {}) => {
  // Found via checkJs (lucide, PEAKUB DX initiative): this whole chain used to run with no
  // `return`/`await` at all - a genuine fire-and-forget bug. The function resolved with
  // `undefined` immediately, before the query even ran, let alone the destroy. That in turn
  // broke `destroyAllRowsWithQuery` below, whose loop condition is this function's resolved
  // count: since it was always `undefined`, that function always stopped after issuing exactly
  // one (also fire-and-forget) batch, silently leaving every row past the first `limitPerBatch`
  // undeleted whenever a caller awaited it expecting a full cascade delete.
  const results = await query.limit(limitPerBatch).find({ useMasterKey: true });
  await Servable.App.Object.destroyAll(results);
  return results.length;
};

/**
 * @param {object} [props]
 * @param {any} [props.query] - a Parse.Query, re-run (re-`.limit()`'d) once per batch until
 *   exhausted - safe to pass a fresh, unconsumed query even though `destroyRowsWithQuery` itself
 *   mutates whatever query it's given.
 * @param {number} [props.limitPerBatch]
 */
export const destroyAllRowsWithQuery = async ({
  query,
  limitPerBatch = 1000
} = {}) => {
  return destroyRowsWithQuery({ query, limitPerBatch }).then(function (count) {
    return count
      ? destroyAllRowsWithQuery({ query, limitPerBatch })
      : Promise.resolve();
  });
};

/**
 * @param {object} [props]
 * @param {{ masterKey?: string, userID?: string }} [props.params] - read only when `user` isn't
 *   already given; authenticates the request via the server's own master key rather than a
 *   session.
 * @param {Record<string, string>} [props.headers] - read only when `user` isn't already given
 *   and `params.masterKey` is absent; falls back to the `x-parse-master-key` header.
 * @param {any} [props.user] - an already-resolved Parse.User; when given, skips the master-key
 *   path entirely.
 * @param {{ includes?: string[], excludes?: string[] }} [props.fetchOptions]
 */
export const prepareRequestWithUser = async ({
  params,
  headers,
  user,
  fetchOptions = {}
} = {}) => {
  if (user) {
    if (!fetchOptions.includes && !fetchOptions.excludes) {
      return user;
    }

    return user.fetchWithInclude(fetchOptions.includes, { useMasterKey: true });
  }

  const { masterKey, userID } = params;
  const headerMasterKey = headers["x-parse-master-key"];
  const _masterKey = masterKey ? masterKey : headerMasterKey;
  // #TODO: remove process.env
  if (_masterKey !== process.env.SERVABLE_MASTER_KEY) {
    throw new Error("Please provide a master key");
  }

  const _user = await fetchObjectIfNeeded({
    object: userID,
    className: "_User",
    ...fetchOptions
  });
  if (!_user) {
    throw new Error("Could not find user.");
  }

  return _user;
};

/**
 * Destroys the single-Pointer object stored at each of `keys` on `object`, if set.
 * @param {object} props
 * @param {any} props.object
 * @param {string[]} props.keys
 */
export const destroyItems = async ({ object, keys }) => {
  return Promise.all(keys.map(key => destroyItem({ key, object })));
};

/**
 * @param {object} props
 * @param {any} props.object
 * @param {string} props.key - a field holding a single Pointer.
 */
export const destroyItem = async props => {
  const { object, key } = props;
  const item = object.get(key);
  if (!item) {
    return;
  }

  return item.destroy({ useMasterKey: true });
};

/**
 * @param {object} props
 * @param {any} props.object
 * @param {string} props.key - a field holding an array of Pointers.
 */
export const destroyItemsInArray = async props => {
  const { object, key } = props;
  const items = object.get(key);
  if (!items) {
    return;
  }

  return Promise.all(items.map(_destroyItemInArray));
};

// `path` defaults to the directory this always used to hard-code, so existing callers
// keep writing where they did - but it is now actually honoured instead of being accepted
// and ignored.
export const saveFileDataToFS = async ({ file, path = "/uploads" }) => {
  if (!file) {
    return null;
  }

  try {
    const data = await file.getData();
    if (!data) {
      return null;
    }

    // `recursive: true` rather than an existsSync() guard: it creates parents as needed
    // and, unlike plain mkdir(), does NOT throw EEXIST when the directory is already
    // there. The guard it replaces was `fs.existsSync()` called with no argument at all,
    // so it always evaluated false and mkdir ran on every call - meaning that once the
    // directory existed (the normal case - it is usually a mount), every call threw
    // EEXIST, got swallowed by the catch below, and returned null having written nothing.
    // (`fs` was also never imported in this module, so the very first statement threw a
    // ReferenceError into that same catch - this function had never once succeeded.)
    await fs.promises.mkdir(path, { recursive: true });

    const filePath = `${path}/${file.name}`;
    await fs.promises.writeFile(filePath, data);
    // Returned so a caller can tell success from the null returned on every failure path.
    return filePath;
  } catch (e) {
    console.error(e);
    return null;
  }
};

const _destroyItemInArray = async item => {
  return item.destroy({ useMasterKey: true });
};
