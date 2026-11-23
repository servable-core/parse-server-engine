export function isDecodedIntoFreshPlainValues(raw: any, depth?: number): boolean;
export function createTheLazyFetchSnapshot({ CoreManager, ParseObject, ParseFile, ParseRelation, encode, decode, UniqueInstanceStateController }: {
    CoreManager: any;
    ParseObject: any;
    ParseFile: any;
    ParseRelation: any;
    encode: (value: any, disallowObjects?: boolean, forcePointers?: boolean) => any;
    decode: (value: any) => any;
    UniqueInstanceStateController: any;
}): {
    install: () => {
        isInstalled: boolean;
        reason: string;
    } | {
        isInstalled: boolean;
        reason?: undefined;
    };
    uninstall: () => void;
    wrapTheStateController: (controller: any) => any;
    isDecodedIntoFreshPlainValues: (raw: any, depth?: number) => boolean;
};
export function sdkModules(): Parameters<typeof createTheLazyFetchSnapshot>[0];
export function installTheLazyFetchSnapshot({ isEnabled, loadSdkModules }: {
    isEnabled: boolean;
    loadSdkModules?: () => Parameters<typeof createTheLazyFetchSnapshot>[0];
}): Promise<{
    isInstalled: boolean;
    reason?: string;
}>;
