import fg from 'fast-glob'

/**
 * Globs `path` and dynamically imports every matched file.
 * @param {object} props
 * @param {string} props.path
 * @param {import('fast-glob').Options} [props.globOptions]
 * @returns {Promise<any[] | null>} the imported modules, or `null` if the glob/import failed.
 */
export default async ({ path,
  // Was `{ mark: true }` - `mark` is the older `glob`-package option name; fast-glob's real
  // equivalent is `markDirectories` (found via checkJs, lucide/PEAKUB DX initiative). Left as-is
  // it was silently ignored, though harmlessly here since directory entries were never a
  // realistic match for `import()` anyway.
  globOptions = { markDirectories: true },
}) => {
  try {
    const entries = await fg([path], globOptions)
    return Promise.all(entries.map(entry => import(entry)))
  }
  catch (e) {
    console.error(e)
    return null
  }
}
