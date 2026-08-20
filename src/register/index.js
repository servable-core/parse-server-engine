import _parse from './parse/index.js'
import ParseServer from "parse-server"
import route from './route/index.js'
import jobs from './jobs/index.js'
import createTransaction from './transaction/index.js'
import Query from './query/index.js'

ParseServer.S3Adapter

export default async ({ servableConfig }) => {
  const Transaction = createTransaction({ Parse })

  return ({
    ..._parse,
    Object: Parse.Object,
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
    Jobs: jobs({ servableConfig })
  })
}

