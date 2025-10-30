import express from "express";
import cors from 'cors';
import compression from 'compression';
// import bodyParser from 'body-parser'
import qs from 'qs';
import cookieParser from "cookie-parser";


export default async ({ servableConfig }) => {

  const app = express()
  app.use(compression())
  // app.use(cors(corsOptions))
  // app.use(express.json({
  //   limit: servableConfig.envs['engineMaxUploadSize'],
  // }))

  app.use(cookieParser());       // ✅ parses cookies into req.cookies

  const corsOptions = servableConfig.configuration?.config?.cors || {}
  const { allowedOrigins } = corsOptions
  console.log('[ENGINE] corsOptions', corsOptions)
  if (allowedOrigins?.length) {
    app.use(cors({
      origin: (origin, callback) => {
        // console.log('[ENGINE] checking origin', origin, 'in', allowedOrigins)
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
      credentials: true,            // 👈 important for cookies
      optionsSuccessStatus: 200,    // legacy browser support
    }))
  }
  else {
    app.use(cors())
  }



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
