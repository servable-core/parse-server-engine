// import fs from 'fs'
// import YAML from 'yaml'

import { fileURLToPath } from "url"
import { dirname } from "path"
import envOr from '../lib/envOr'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)



export default {
  docker: {
    // data: async () => {
    //   const path = `./docker/docker-compose.yaml`
    //   const fileUrl = new URL(path, import.meta.url)
    //   const file = fs.readFileSync(fileUrl, 'utf8')
    //   const parsed = YAML.parse(file)
    //   return parsed
    // },
    path: () => {
      return `${__dirname}/docker`
    },
    amendServices: async ({
      services,
      servableConfig,
    }) => {

    }
  },
  adaptAppPayload: async ({
    item,
    config,
    servableConfig,
    schema }) => {

    if (!config || !config.services) {
      return {}
    }

    const mongoService = config.services['database-mongo']
    const configSERVABLE_DATABASE_URI = mongoService ?
      `mongodb://${mongoService.environment.MONGO_INITDB_ROOT_USERNAME}:${mongoService.environment.MONGO_INITDB_ROOT_PASSWORD}@localhost:${mongoService.ports[0].published}/${mongoService.environment.MONGO_INITDB_DATABASE}?authSource=admin&readPreference=primary&ssl=false`
      : ''

    const configSERVABLE_UTILS_DATABASE_URI = mongoService ?
      `mongodb://${mongoService.environment.MONGO_INITDB_ROOT_USERNAME}:${mongoService.environment.MONGO_INITDB_ROOT_PASSWORD}@localhost:${mongoService.ports[0].published}/utils?authSource=admin&readPreference=primary&ssl=false`
      : ''

    const storageService = config.services['minio']
    const filesAdapterEndPoint = `http://localhost:${storageService.ports[0].published}`

    const liveQueryService = config.services['liveserver-redis-cache']
    let engineRedisLiveServerDBURI = null
    if (liveQueryService) {
      engineRedisLiveServerDBURI = `redis://:${liveQueryService.environment.REDIS_PASSWORD}@localhost:${liveQueryService.ports[0].published}`
    }

    return {
      utilsDatabaseURI: envOr(process.env.SERVABLE_UTILS_DATABASE_URI, configSERVABLE_UTILS_DATABASE_URI), //#TODO: remove from engine
      filesAdapterEndPoint: envOr(process.env.ENGINE_OBJECTSTORAGE_ENDPOINT, filesAdapterEndPoint),
      databaseURI: envOr(process.env.ENGINE_DATABASE_URI, configSERVABLE_DATABASE_URI),
    }
  }
}
