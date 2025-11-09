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

  const corsOptions = servableConfig.configuration?.config?.cors || {};
  const { allowedOrigins } = corsOptions;
  console.log('[ENGINE] corsOptions', corsOptions);

  if (allowedOrigins?.length) {
    app.use(cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (like curl, Postman, mobile apps)
        if (!origin) {
          return callback(null, true);
        }

        try {
          const hostname = new URL(origin).hostname;

          // 1️⃣ Exact match check
          if (allowedOrigins.includes(origin)) {
            return callback(null, true);
          }

          // 2️⃣ Subdomain match for any of the allowed domains
          for (const allowedOrigin of allowedOrigins) {
            // Escape dots for regex and allow subdomains
            const regex = new RegExp(`(^|\\.)${allowedOrigin.replace(/\./g, '\\.')}$`);
            if (regex.test(hostname)) {
              return callback(null, true);
            }
          }

          // 3️⃣ Otherwise, reject
          return callback(new Error("Not allowed by CORS"));
        } catch (err) {
          console.error('[ENGINE] Invalid origin:', origin, err);
          return callback(new Error("Invalid origin"));
        }
      },
      credentials: true,            // important for cookies/auth headers
      optionsSuccessStatus: 200,    // legacy browser support
    }));
  } else {
    app.use(cors()); // fallback: open CORS
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
