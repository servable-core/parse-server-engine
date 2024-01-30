import express from "express"
// import Fastify from 'fastify'
// import fastifyExpress from '@fastify/express'
import cors from 'cors'
import compression from 'compression'
//TODO:
import parseServerImageResizeByurl from './middlewares/imageSize/index.js'
//import imageHostMiddleware from './middlewares/imageHost'

export default async () => {
  const app = express()

  // const whitelist = [
  //   'localhost',
  //   'abounak.local',
  //   'servable.app'
  // ]

  // const corsOptions = {
  //   origin: function (origin, callback) {
  //     if (whitelist.indexOf(origin) !== -1) {
  //       callback(null, true)
  //     } else {
  //       callback(new Error('Not allowed by CORS'))
  //     }
  //   },
  // }

  app.use(compression())
  app.use(cors())
  // app.use(cors(corsOptions))
  //app.options('*', cors()) // include before other routes

  //TODO:
  app.use(parseServerImageResizeByurl())
  //app.use(imageHostMiddleware())

  //https://reactgo.com/request-entity-too-large-node/
  //File limit should be repercuted in express too:
  app.use(express.json({
    limit: process.env.MAX_UPLOAD_SIZE
  }))

  app.use(express.urlencoded({
    limit: process.env.MAX_UPLOAD_SIZE,
    extended: true,
    parameterLimit: 1000000
  }))


  return app
}





// const app = Fastify()
// await app.register(fastifyExpress)
