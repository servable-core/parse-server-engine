declare namespace _default {
    export { createApp };
    export { createHttpServer };
    export { launch };
    export { doLaunch };
    export { launchLiveServer };
    export { setConfigurations };
    export { adaptApp };
    export { adaptAppNative };
    export { formatAppClassesSchemas };
    export { system };
    export { createStateStore };
    export function test(): void;
}
export default _default;
import createApp from './createapp/index.js';
import createHttpServer from './httpServer/index.js';
import launch from './launch/index.js';
import doLaunch from './doLaunch/index.js';
import launchLiveServer from './liveServer/index.js';
import setConfigurations from './setConfigurations/index.js';
import adaptApp from './register/index.js';
import adaptAppNative from './register/index.native.js';
import formatAppClassesSchemas from './formatAppClassesSchemas/index.js';
import system from './system/index.js';
import createStateStore from './stateStore/index.js';
