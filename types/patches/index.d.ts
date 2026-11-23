export function installTheEnginePatches({ engineOptions }: {
    engineOptions: {
        isFastObjectGetEnabled: boolean;
        isSchemaControllerReuseEnabled: boolean;
        isLazyFetchSnapshotEnabled?: boolean;
    };
}): Promise<{
    fastObjectGet: {
        isInstalled: boolean;
        reason?: string;
    };
    schemaControllerReuse: {
        isInstalled: boolean;
        reason?: string;
    };
    lazyFetchSnapshot: {
        isInstalled: boolean;
        reason?: string;
    };
}>;
export default installTheEnginePatches;
