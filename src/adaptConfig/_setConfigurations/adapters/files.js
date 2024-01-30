export default {
  module: "parse-server-s3like-adapter",
  options: {
    accessKey: process.env.SERVABLE_OBJECTSTORAGE_ROOT_USER,
    secretKey: process.env.SERVABLE_OBJECTSTORAGE_ROOT_PASSWORD,
    bucket: process.env.SERVABLE_OBJECTSTORAGE_BUCKET_NAME,
    direct: false,
    endPoint: process.env.SERVABLE_OBJECTSTORAGE_ENDPOINT
  }
}
