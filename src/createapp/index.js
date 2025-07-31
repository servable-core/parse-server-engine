import express from "express"
import cors from 'cors'
import compression from 'compression'
// import bodyParser from 'body-parser'
import qs from 'qs'

export default async ({ servableConfig }) => {
  const app = express()
  app.use(compression())
  app.use(cors())
  app.use(express.json({
    limit: servableConfig.envs['engineMaxUploadSize'],
  }))

  app.use(express.urlencoded({
    limit: servableConfig.envs['engineMaxUploadSize'],
    extended: true,
    parameterLimit: 1000000
  }))
  // app.use(bodyParser.urlencoded({ extended: true }));
  app.set('query parser',
    (str) => qs.parse(str, { allowDots: true }));

  return app
}
