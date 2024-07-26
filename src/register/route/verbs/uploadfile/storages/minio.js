import * as Minio from 'minio'
import multerMinIOStorage from 'multer-minio-storage'

export default ({ bucketName, endPoint,
  accessKey,
  secretKey, }) => {

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
    key: function (req, file, cb) {
      cb(null, Date.now().toString())
    }
  })

  return storage
}
