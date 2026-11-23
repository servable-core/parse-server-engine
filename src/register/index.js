import _parse from './parse/index.js'
import ParseServer from "parse-server"
import route from './route/index.js'
import jobs from './jobs/index.js'
import createTransaction from './transaction/index.js'
import Query from './query/index.js'
import createObject from './object/index.js'
import createTyped from './typed/index.js'
import createIndexes, { adapterResolverFor } from '../indexes/index.js'

ParseServer.S3Adapter

export default async ({ servableConfig }) => {
  const Transaction = createTransaction({ Parse, servableConfig })
  const ObjectClass = createObject({ Parse })

  return ({
    ..._parse,
    Object: ObjectClass,
    Query,
    Cloud: Parse.Cloud,
    User: Parse.User,
    Role: Parse.Role,
    File: Parse.File,
    Installation: Parse.Installation,
    LiveQuery: Parse.LiveQuery,
    Session: Parse.Session,
    Schema: Parse.Schema,
    Config: Parse.Config,
    ACL: Parse.ACL,
    Transaction,
    Route: route({ servableConfig }),
    Jobs: jobs({ servableConfig }),
    Typed: createTyped({ ObjectClass, QueryClass: Query }),
    // Indexes Parse's schema cannot make, made through the storage adapter in the background (indexes/index.js):
    // `Servable.App.Indexes.ensure({ className, name, keys, isUnique, isSparse, partialFilter, fieldTypes })`.
    Indexes: {
      ensure: createIndexes({
        resolveAdapter: adapterResolverFor(() => /** @type {any} */ (globalThis).Parse?.applicationId ?? servableConfig?.envs?.appID),
      }).ensure,
    },
  })
}

