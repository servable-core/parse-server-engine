import envOr from "../lib/envOr.js"

export default (servableConfig) => {

  servableConfig.envs["engineDatabaseRootUser"] = envOr(
    servableConfig.envs["engineDatabaseRootUser"],
    envOr(
      process.env.ENGINE_DATABASE_ROOT_USER,
      "root"
    ))
  servableConfig.envs["engineDatabaseRootPassword"] = envOr(
    servableConfig.envs["engineDatabaseRootPassword"],
    envOr(
      process.env.ENGINE_DATABASE_ROOT_PASSWORD,
      "DATABASE_PASSWORD_TO_CHANGE"
    ))
  servableConfig.envs["engineDatabaseDefaultDatabase"] = envOr(
    servableConfig.envs["engineDatabaseDefaultDatabase"],
    envOr(
      process.env.ENGINE_DATABASE_DEFAULT_DATABASE,
      "app"
    ))

  servableConfig.envs["engineMount"] = envOr(
    servableConfig.envs["engineMount"],
    envOr(
      process.env.ENGINE_MOUNT,
      "/parse"
    ))

  servableConfig.envs["engineDashboardUserId"] = envOr(
    servableConfig.envs["engineDashboardUserId"],
    envOr(
      process.env.ENGINE_DASHBOARD_USER_ID,
      "admin"
    ))

  servableConfig.envs["engineDashboardUserPassword"] = envOr(
    servableConfig.envs["engineDashboardUserPassword"],
    envOr(
      process.env.PASSWORD_TO_CHANGE,
      "PASSWORD_TO_CHANGE"
    ))

  servableConfig.envs["engineObjectStorageRootUsername"] = envOr(
    servableConfig.envs["engineObjectStorageRootUsername"],
    envOr(
      process.env.ENGINE_OBJECTSTORAGE_ROOT_USER,
      "S3_USERNAME_TO_CHANGE"
    ))

  servableConfig.envs["engineObjectStorageRootPassword"] = envOr(
    servableConfig.envs["engineObjectStorageRootPassword"],
    envOr(
      process.env.ENGINE_OBJECTSTORAGE_ROOT_PASSWORD,
      "S3_PASSWORD_TO_CHANGE"
    ))

  servableConfig.envs["engineObjectStorageBucketName"] = envOr(
    servableConfig.envs["engineObjectStorageBucketName"],
    envOr(
      process.env.ENGINE_OBJECTSTORAGE_BUCKET_NAME,
      "primary"
    ))

  servableConfig.envs["engineMaxUploadSize"] = envOr(
    servableConfig.envs["engineMaxUploadSize"],
    envOr(
      process.env.ENGINE_MAX_UPLOAD_SIZE,
      "200000mb"
    ))

  servableConfig.envs["filesAdapterEndPoint"] = envOr(
    servableConfig.envs["filesAdapterEndPoint"],
    process.env.ENGINE_OBJECTSTORAGE_ENDPOINT,
  )

  servableConfig.envs["databaseURI"] = envOr(
    servableConfig.envs["databaseURI"],
    process.env.ENGINE_DATABASE_URI,
  )
}
