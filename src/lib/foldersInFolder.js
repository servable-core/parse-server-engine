import checkFileExists from './checkFileExists.js'
import fs from 'fs'
import _path from 'path'
import _ from 'underscore'

export default async ({ path, }) => {
  try {
    if (!(await checkFileExists(path))) {
      return null
    }

    const items = await fs.promises.readdir(path)

    if (!items || !items.length) {
      return null
    }

    let results = (await Promise.all(items.map(async item => {
      if (item.includes('spec.js')) {
        return null
      }

      const __path = _path.join(path, item)

      const _stat = await fs.promises.stat(__path)
      if (!_stat) {
        return null
      }

      const isDir = _stat.isDirectory()
      if (!isDir) {
        return null
      }

      return { path: __path, stat: _stat, name: item }

    }))).filter(a => a)

    results = _.flatten(results)
    return results
  }
  catch (e) {
    console.error(e)
    return null
  }
}
