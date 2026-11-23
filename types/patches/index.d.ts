export function installTheEnginePatches({ engineOptions }: {
    engineOptions: {
        isFastObjectGetEnabled: boolean;
        isSchemaControllerReuseEnabled: boolean;
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
}>;
export default installTheEnginePatches;
