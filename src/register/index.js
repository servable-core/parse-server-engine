import _parse from './parse/index.js'
import ParseServer from "parse-server"
import route from './route/index.js'
import jobs from './jobs/index.js'

ParseServer.S3Adapter

export default async ({ servableConfig }) => ({
  ..._parse,
  Object: Parse.Object,
  Query: Parse.Query,
  Cloud: Parse.Cloud,
  User: Parse.User,
  Role: Parse.Role,
  File: Parse.File,
  Installation: Parse.Installation,
  LiveQuery: Parse.LiveQuery,
  Session: Parse.Session,
  Schema: Parse.Schema,
  Config: Parse.Config,
  Schema: Parse.Schema,
  ACL: Parse.ACL,
  Route: route({ servableConfig }),
  Jobs: jobs({ servableConfig })
})

