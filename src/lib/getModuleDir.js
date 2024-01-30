import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'

/**
 * Get's the file path to a module folder.
 * @param {string} moduleEntry 
 * @param {string} fromFile 
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