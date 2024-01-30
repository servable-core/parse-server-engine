import fs from 'fs'
import path from 'path'
import checkFileExists from './checkFileExists'

const operation = async filePath => {
  var dirname = path.dirname(filePath)
  if (!(await checkFileExists(dirname))) {
    return true
  }
  ensureDirectoryExistence(dirname)
  fs.promises.mkdir(dirname)
}

export default operation
