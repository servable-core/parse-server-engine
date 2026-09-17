import fs from 'fs'
import path from 'path'
import checkFileExists from './checkFileExists.js'

/**
 * Ensures the directory containing `filePath` exists, creating any missing parent directories
 * along the way (like `mkdir -p`).
 * @param {string} filePath
 * @returns {Promise<true>}
 */
const operation = async filePath => {
  // Was inverted (`if (!exists) return true` - claimed success and returned WITHOUT creating
  // anything whenever the directory was actually missing, the one case this function exists
  // for) and called an undefined `ensureDirectoryExistence` (never awaited `mkdir` either) on
  // the path where the directory already existed. Rewritten to do what the name says (found via
  // checkJs, lucide/PEAKUB DX initiative; same bug pattern already found and fixed in
  // @servable/server and @servable/tools's own copies of this file).
  const dirname = path.dirname(filePath)
  if (await checkFileExists(dirname)) {
    return true
  }
  await fs.promises.mkdir(dirname, { recursive: true })
  return true
}

export default operation
