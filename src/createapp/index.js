import express from "express"
import cors from 'cors'
import compression from 'compression'
// import bodyParser from 'body-parser'
import qs from 'qs'


export default async ({ servableConfig }) => {
  const app = express()
  app.use(compression())
  app.use(cors())
  // app.use(express.json({
  //   limit: servableConfig.envs['engineMaxUploadSize'],
  // }))

  app.use(express.urlencoded({
    limit: servableConfig.envs['engineMaxUploadSize'],
    extended: true,
    parameterLimit: 1000000
  }))

  const numberRegex = /^-?\d+(\.\d+)?$/

  app.set('query parser',
    (str) => qs.parse(
      str,
      {
        allowDots: true,
        decoder: (str, defaultDecoder, charset, type) => {
          // const val = defaultDecoder(str, defaultDecoder, charset, type);
          // if (/^\d+$/.test(val)) {
          //   return Number(val);
          // }
          // return val;
          const val = defaultDecoder(str, defaultDecoder, charset, type);

          // Only convert if it looks like a number
          if (typeof val === 'string' && numberRegex.test(val)) {
            const num = Number(val);
            // Ensure not NaN
            if (!Number.isNaN(num)) {
              return num;
            }
          }

          if (typeof val === 'string' && (val === 'false')) {
            return false
          }

          if (typeof val === 'string' && (val === 'true')) {
            return true
          }

          return val;
        }
      }))

  return app
}
