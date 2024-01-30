import checkFileExists from './checkFileExists.js'
import fs from 'fs'
import _path from 'path'
import _ from 'underscore'
//https://www.npmjs.com/package/directory-import


const perform = async ({ path,
  includeMeta = false,
  excludes = ['spec.js'],
  includeExtensions = ['.js', '.ts', '.json']
}) => {
  try {
    if (!(await checkFileExists(path))) {
      return null
    }

    const items = await fs.promises.readdir(path)

    if (!items || !items.length) {
      return null
    }

    let results = (await Promise.all(items.map(async item => {


      const __path = _path.join(path, item)

      const _stat = await fs.promises.stat(__path)
      if (!_stat) {
        return null
      }

      const isDir = _stat.isDirectory()
      if (isDir) {
        return perform({ path: __path })
      }

      if (!(await checkFileExists(__path))) {
        return null
      }

      if (item.includes('spec.js')) {
        return null
      }
      const extension = getExtension(item)
      if (!includeExtensions.includes(extension)) {
        return null
      }

      if (includeMeta) {
        const racine = getFileRaw(__path)
        const _module = await import(__path)
        const md = `${racine}.md`
        let documentation = null
        if ((await checkFileExists(md))) {
          documentation = await fs.promises.readFile(md, 'utf8')
        }

        return [{
          module: _module,
          path: __path,
          documentation
        }]
      } else {
        return [(await import(__path))]
      }
    }))).filter(a => a)

    results = _.flatten(results)
    return results
  }
  catch (e) {
    console.error(e)
    return null
  }
}

const getExtension = str => str.slice(str.lastIndexOf("."))
const getFileRaw = str => str.split('.').slice(0, -1).join('.')


export default perform
