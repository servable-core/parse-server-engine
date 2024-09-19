// import createCacheAdapter from './adapters/cache.js'

export default ({
  servableConfig,
  live,
  configuration
}) => {

  const _configuration = {
    ...configuration,
    key: "production",
    enabled: true,
    params: {},
    lock: {
      enabled: true,
      ...(configuration.lock ? configuration.lock : {}),
      databaseURI: servableConfig.envs.utilsDatabaseURI,
    },
    config: {
      ...(configuration.config ? configuration.config : {}),
      parse: {
        verbose: parseInt(servableConfig.envs.verbose),

        appId: servableConfig.envs.appID,
        serverURL: `${servableConfig.envs.serverURL}${servableConfig.envs.engineMount}`,
        publicServerURL: `${servableConfig.envs.publicURI}${servableConfig.envs.engineMount}`,
        appName: servableConfig.envs.appName,
        masterKey: servableConfig.envs.masterKey,

        // restApiKey: process.env.SERVABLE_REST_API_KEY,
        // javascriptKey: process.env.SERVABLE_JAVASCRIPT_KEY,
        // MaxUploadSize: process.env.ENGINE_MAX_UPLOAD_SIZE,

        // emailAdapter,
        // filesAdapter,
        // cacheAdapter,
        // push,

        verifyUserEmails: false,
        // EmailVerifyTokenValidityDuration: process.env.EMAIL_VERIFY_TOKEN_VALIDITY_DURATION_IS_SET ? process.env.EMAIL_VERIFY_TOKEN_VALIDITY_DURATION_HOURS * 60 * 60 : undefined, // in seconds (2 hours = 7200 seconds)
        // preventLoginWithUnverifiedEmail: process.env.SERVABLE_PREVENT_LOGIN_WITH_UNVERIFIED_EMAIL,
        // auth: {
        //   apple: {
        //     client_id: process.env.SERVABLE_APP_BUNDLE_ID
        //   },
        //   google: {}
        // },
        loggerAdapter: {
          module: "parse-server/lib/Adapters/Logger/WinstonLoggerAdapter",
          options: {
            logLevel: servableConfig.envs.logLevel
          }
        },
        // liveQuery: {
        //   ...(servableConfig.envs.liveQueryServiceUri
        //     ? {
        //       redisURL: servableConfig.envs.liveQueryServiceUri
        //     }
        //     : {})
        // },
        schema: {},
        mountPath: servableConfig.envs.engineMount,
        // ...((configuration.config && configuration.config.parse) ? configuration.config.parse : {}),
        databaseURI: servableConfig.envs.databaseURI,
      },
    },
  }

  if (live && !_configuration.adaptedLive) {
    _configuration.config.parse = {
      // emailAdapter,
      filesAdapter: {
        module: "parse-server-s3like-adapter",
        options: {
          accessKey: servableConfig.envs.engineObjectStorageRootUsername,
          secretKey: servableConfig.envs.engineObjectStorageRootPassword,
          bucket: servableConfig.envs.engineObjectStorageBucketName,
          direct: false,
          endPoint: servableConfig.envs.filesAdapterEndPoint
        }
      },
      // cacheAdapter: _configuration.config.parse.cacheAdapter
      //   ? _configuration.config.parse.cacheAdapter
      //   : createCacheAdapter(props),
      ...(_configuration.config.parse ? _configuration.config.parse : {}),
    }
    _configuration.adaptedLive = true
  }

  return _configuration
}

