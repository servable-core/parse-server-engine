import * as Minio from 'minio'
import multerMinIOStorage from 'multer-minio-storage'

export default ({ bucketName, endPoint,
  accessKey,
  secretKey, nameAdapter }) => {

  const minioClient = new Minio.Client({
    endPoint,
    accessKey,
    secretKey,
  })

  const storage = multerMinIOStorage.default({
    minioClient: minioClient,
    bucket: bucketName,
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname })
    },
    key: async function (req, file, cb) {
      // cb(null, Date.now().toString())
      const name = await nameAdapter({ file, request: req })
      cb(null, name)
    }
  })

  return storage
}
