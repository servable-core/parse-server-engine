import createApp from './createapp/index.js'
import createHttpServer from './httpServer/index.js'
import launch from './launch/index.js'
import doLaunch from './doLaunch/index.js'
import launchLiveServer from './liveServer/index.js'
import setConfigurations from './setConfigurations/index.js'

import adaptApp from './register/index.js'
import adaptAppNative from './register/index.native.js'
import formatAppClassesSchemas from './formatAppClassesSchemas/index.js'
import system from './system/index.js'

export default {
  createApp,
  createHttpServer,
  // launchWithMigration/launchWithNoMigration collapsed into one `launch` - see
  // .docs/technical/unischema-plan.md and launch/index.js's own comment for why the
  // migrate/no-migrate distinction no longer exists.
  launch,
  doLaunch,
  launchLiveServer,
  setConfigurations,
  adaptApp,
  adaptAppNative,
  formatAppClassesSchemas,
  system,
  test: () => {
    console.log("Hello from engine test function!")
  }
}
