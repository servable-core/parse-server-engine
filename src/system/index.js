// import fs from 'fs'
// import YAML from 'yaml'

import { fileURLToPath } from "url"
import { dirname } from "path"
import envOr from '../lib/envOr.js'
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
  },
  adaptAppPayload: async ({
    item,
    config,
    servableConfig,
    schema }) => {

    if (!config || !config.services) {
      return {}
    }

    const mongoService = config.services['engine-database-mongo']
    const configSERVABLE_DATABASE_URI = mongoService ?
      `mongodb://${mongoService.environment.MONGO_INITDB_ROOT_USERNAME}:${mongoService.environment.MONGO_INITDB_ROOT_PASSWORD}@localhost:${mongoService.ports[0].published}/${mongoService.environment.MONGO_INITDB_DATABASE}?authSource=admin&readPreference=primary&ssl=false`
      : ''

    const configSERVABLE_UTILS_DATABASE_URI = mongoService ?
      `mongodb://${mongoService.environment.MONGO_INITDB_ROOT_USERNAME}:${mongoService.environment.MONGO_INITDB_ROOT_PASSWORD}@localhost:${mongoService.ports[0].published}/utils?authSource=admin&readPreference=primary&ssl=false`
      : ''

    let filesAdapterEndPoint
    const storageService = config.services['engine-minio']
    if (storageService) {
      const port = storageService.ports.find(a => a.target === 9000)
      filesAdapterEndPoint = `http://localhost:${port.published}`
    }


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
