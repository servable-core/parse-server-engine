import push from "../adapters/push.js"
import createCacheAdapter from '../adapters/cache.js'

export default (props) => {
  const { live, payload = {}, } = props


  const config = {
    ...(props.configuration.config ? props.configuration.config : {}),
    parse: {
      verbose: parseInt(process.env.SERVABLE_VERBOSE),

      appId: process.env.SERVABLE_APP_ID,
      serverURL: `${process.env.SERVABLE_SERVER_URL}${process.env.SERVABLE_MOUNT}`,
      publicServerURL: `${process.env.SERVABLE_PUBLIC_SERVER_URL}${process.env.SERVABLE_MOUNT}`,
      appName: process.env.SERVABLE_APP_NAME,
      masterKey: process.env.SERVABLE_MASTER_KEY,

      restApiKey: process.env.SERVABLE_REST_API_KEY,
      javascriptKey: process.env.SERVABLE_JAVASCRIPT_KEY,
      // MaxUploadSize: process.env.MAX_UPLOAD_SIZE,

      // emailAdapter,
      // filesAdapter,
      // cacheAdapter,
      // push,

      verifyUserEmails: false,
      // EmailVerifyTokenValidityDuration: process.env.EMAIL_VERIFY_TOKEN_VALIDITY_DURATION_IS_SET ? process.env.EMAIL_VERIFY_TOKEN_VALIDITY_DURATION_HOURS * 60 * 60 : undefined, // in seconds (2 hours = 7200 seconds)
      // preventLoginWithUnverifiedEmail: process.env.SERVABLE_PREVENT_LOGIN_WITH_UNVERIFIED_EMAIL,
      auth: {
        apple: {
          client_id: process.env.SERVABLE_APP_BUNDLE_ID
        },
        google: {}
      },
      loggerAdapter: {
        module: "parse-server/lib/Adapters/Logger/WinstonLoggerAdapter",
        options: {
          logLevel: process.env.SERVABLE_LOG_LEVEL
        }
      },
      liveQuery: {
        ...(payload.liveQueryServiceUri
          ? {
            redisURL: payload.liveQueryServiceUri ? payload.liveQueryServiceUri : process.env.SERVABLE_REDIS_LIVESERVER_DB_URI
          }
          : {})
      },
      schema: {},
      mountPath: process.env.SERVABLE_MOUNT || "/parse",
      ...((props.configuration.config && props.configuration.config.parse) ? props.configuration.config.parse : {}),
      databaseURI: payload.databaseURI ? payload.databaseURI : process.env.SERVABLE_DATABASE_URI,
    },
  }

  if (live && !props.configuration.adaptedLive) {
    config.parse = {
      // emailAdapter,
      filesAdapter: {
        module: "parse-server-s3like-adapter",
        options: {
          accessKey: process.env.SERVABLE_OBJECTSTORAGE_ROOT_USER,
          secretKey: process.env.SERVABLE_OBJECTSTORAGE_ROOT_PASSWORD,
          bucket: process.env.SERVABLE_OBJECTSTORAGE_BUCKET_NAME,
          direct: false,
          endPoint: payload.filesAdapterEndPoint ? payload.filesAdapterEndPoint : process.env.SERVABLE_OBJECTSTORAGE_ENDPOINT
        }
      },
      cacheAdapter: props.configuration.config.parse.cacheAdapter
        ? props.configuration.config.parse.cacheAdapter
        : createCacheAdapter(props),
      push,
      ...(props.configuration.config.parse ? props.configuration.config.parse : {}),
    }

  }

  return config
}
