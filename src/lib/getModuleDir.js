import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'

/**
 * Resolves the on-disk directory of an installed npm package (or scoped package), by walking
 * `require.resolve.paths()` for the first `node_modules/<packageName>` that actually exists.
 * @param {string} moduleEntry - a package name, or `package/subpath` (only the package name part
 *   is used to locate the directory).
 * @returns {string | undefined} the package's directory, or `undefined` if not found.
 */
export default (moduleEntry) => {
    const packageName = moduleEntry.includes('/')
        ? moduleEntry.startsWith('@')
            ? moduleEntry.split('/').slice(0, 2).join('/')
            : moduleEntry.split('/')[0]
        : moduleEntry;
    const require = createRequire(import.meta.url);
    const lookupPaths = require.resolve.paths(moduleEntry).map((p) => path.join(p, packageName));
    return lookupPaths.find((p) => fs.existsSync(p));
};