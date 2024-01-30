export const getOnePlain = async props => {
  const { objectId, className, useMasterKey = false } = props;
  const query = new Servable.App.Query(className);
  query.equalTo("objectId", objectId);

  return query.first({ useMasterKey });
};

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

export const getOneGeneric = async ({ objectId, className, include } = {}) => {
  const query = new Servable.App.Query(className);
  include && query.include(include);
  query.equalTo("objectId", objectId);
  return query.first({ useMasterKey: true });
};

export const performBatchOnQuery = async ({
  query,
  batchSize = 100,
  action
}) => {
  const count = await query.count({ useMasterKey: true });
  const expectedLoops = parseInt(count / batchSize);
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

export const destroyRowsWithQuery = async ({ query, limitPerBatch } = {}) => {
  query
    .limit(limitPerBatch)
    .find()
    .then(function(results) {
      return Servable.App.Object.destroyAll(results).then(function() {
        return Promise.resolve(results.length);
      });
    });
};

export const destroyAllRowsWithQuery = async ({
  query,
  limitPerBatch = 1000
} = {}) => {
  return destroyRowsWithQuery({ query, limitPerBatch }).then(function(count) {
    return count
      ? destroyAllRowsWithQuery({ query, limitPerBatch })
      : Promise.resolve();
  });
};

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

export const destroyItems = async ({ object, keys }) => {
  return Promise.all(keys.map(key => destroyItem({ key, object })));
};

export const destroyItem = async props => {
  const { object, key } = props;
  const item = object.get(key);
  if (!item) {
    return;
  }

  return item.destroy({ useMasterKey: true });
};

export const destroyItemsInArray = async props => {
  const { object, key } = props;
  const items = object.get(key);
  if (!items) {
    return;
  }

  return Promise.all(items.map(_destroyItemInArray));
};

export const saveFileDataToFS = async ({ file, path = "temp/files" }) => {
  if (!file) {
    return null;
  }

  try {
    const data = await file.getData();
    if (!data) {
      return null;
    }

    const dirPath = "/uploads";
    if (!fs.existsSync()) {
      await fs.promises.mkdir(dirPath);
    }

    const filePath = `${dirPath}/${file.name}`;
    await fs.promises.writeFile(filePath, data);
  } catch (e) {
    console.error(e);
    return null;
  }
};

const _destroyItemInArray = async item => {
  return item.destroy({ useMasterKey: true });
};
