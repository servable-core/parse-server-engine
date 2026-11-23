import { installTheFastObjectGet } from './fastObjectGet.js'
import { installTheSchemaControllerReuse } from './reuseSchemaController.js'
import { installTheLazyFetchSnapshot } from './lazyFetchSnapshot.js'

/**
 * The engine's changes to Parse's own behaviour, each behind its option (../options/index.js), installed once at
 * launch right after Parse Server has started and before the app's hooks run. Never throws: a patch that cannot
 * be installed leaves Parse as it is, and says so in the log.
 * @param {object} props
 * @param {{ isFastObjectGetEnabled: boolean, isSchemaControllerReuseEnabled: boolean, isLazyFetchSnapshotEnabled?: boolean }} props.engineOptions
 * @returns {Promise<{ fastObjectGet: { isInstalled: boolean, reason?: string }, schemaControllerReuse: { isInstalled: boolean, reason?: string }, lazyFetchSnapshot: { isInstalled: boolean, reason?: string } }>}
 */
export const installTheEnginePatches = async ({ engineOptions }) => {
  const [schemaControllerReuse, fastObjectGet, lazyFetchSnapshot] = await Promise.all([
    installTheSchemaControllerReuse({ isEnabled: engineOptions.isSchemaControllerReuseEnabled }),
    installTheFastObjectGet({ isEnabled: engineOptions.isFastObjectGetEnabled }),
    installTheLazyFetchSnapshot({ isEnabled: Boolean(engineOptions.isLazyFetchSnapshotEnabled) }),
  ])
  console.info('[ENGINE] patches', {
    schemaControllerReuse: schemaControllerReuse.isInstalled ? 'installed' : schemaControllerReuse.reason,
    fastObjectGet: fastObjectGet.isInstalled ? 'installed' : fastObjectGet.reason,
    lazyFetchSnapshot: lazyFetchSnapshot.isInstalled ? 'installed' : lazyFetchSnapshot.reason,
  })
  return { fastObjectGet, schemaControllerReuse, lazyFetchSnapshot }
}

export default installTheEnginePatches
