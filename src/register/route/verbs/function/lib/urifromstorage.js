export default ({ storage, file, name }) => {
  const {
    type,
    params
  } = storage
  let uri
  switch (type) {
    case 'minio': {
      uri = `https://${params.endPoint}/${params.bucketName}/${name ? name : file.originalname}`
      break
    }
    default: {
      break
    }
  }

  return uri
}
// https://expressjs.com/en/resources/middleware/multer.html
// fieldNameSize	Max field name size	100 bytes
// fieldSize	Max field value size (in bytes)	1MB
// fields	Max number of non-file fields	Infinity
// fileSize	For multipart forms, the max file size (in bytes)	Infinity
// files	For multipart forms, the max number of file fields	Infinity
// parts	For multipart forms, the max number of parts (fields + files)	Infinity
// headerPairs	For multipart forms, the max number of header key=>value pairs to parse	2000
