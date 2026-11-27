export namespace ENGINE_OPTIONS {
    namespace isFastObjectGetEnabled {
        let environmentVariable: string;
        let defaultValue: boolean;
    }
    namespace isSchemaControllerReuseEnabled {
        let environmentVariable_1: string;
        export { environmentVariable_1 as environmentVariable };
        let defaultValue_1: boolean;
        export { defaultValue_1 as defaultValue };
    }
    namespace areDeclaredIndexesEnsured {
        let environmentVariable_2: string;
        export { environmentVariable_2 as environmentVariable };
        let defaultValue_2: boolean;
        export { defaultValue_2 as defaultValue };
    }
    namespace isSchemaMigrationForced {
        let environmentVariable_3: string;
        export { environmentVariable_3 as environmentVariable };
        let defaultValue_3: boolean;
        export { defaultValue_3 as defaultValue };
    }
    namespace isLazyFetchSnapshotEnabled {
        let environmentVariable_4: string;
        export { environmentVariable_4 as environmentVariable };
        let defaultValue_4: boolean;
        export { defaultValue_4 as defaultValue };
    }
    namespace isQueryValueGuessingEnabled {
        let environmentVariable_5: string;
        export { environmentVariable_5 as environmentVariable };
        let defaultValue_5: boolean;
        export { defaultValue_5 as defaultValue };
    }
    namespace areDeclaredRouteParametersTyped {
        let environmentVariable_6: string;
        export { environmentVariable_6 as environmentVariable };
        let defaultValue_6: boolean;
        export { defaultValue_6 as defaultValue };
    }
    namespace areUndeclaredParameterRoutesRefused {
        let environmentVariable_7: string;
        export { environmentVariable_7 as environmentVariable };
        let defaultValue_7: boolean;
        export { defaultValue_7 as defaultValue };
    }
    namespace areDeclaredRouteBodiesChecked {
        let environmentVariable_8: string;
        export { environmentVariable_8 as environmentVariable };
        let defaultValue_8: boolean;
        export { defaultValue_8 as defaultValue };
    }
}
export function booleanFromEnvironmentValue(rawValue: unknown): boolean | undefined;
export function engineOptionsFrom({ engineConfiguration, env }?: {
    engineConfiguration?: Record<string, any>;
    env?: Record<string, string | undefined>;
}): {
    isFastObjectGetEnabled: boolean;
    isSchemaControllerReuseEnabled: boolean;
    areDeclaredIndexesEnsured: boolean;
    isSchemaMigrationForced: boolean;
    isLazyFetchSnapshotEnabled: boolean;
    isQueryValueGuessingEnabled: boolean;
    areDeclaredRouteParametersTyped: boolean;
    areUndeclaredParameterRoutesRefused: boolean;
    areDeclaredRouteBodiesChecked: boolean;
};
export const ROUTE_CACHE_BYPASS_SECRET_ENVIRONMENT_VARIABLE: "SERVABLE_CACHE_BYPASS_SECRET";
export const ROUTE_CACHE_BYPASS_SECRET_MINIMUM_LENGTH: 16;
export function routeCacheBypassSecretFrom({ engineConfiguration, env }?: {
    engineConfiguration?: Record<string, any>;
    env?: Record<string, string | undefined>;
}): string | null;
export default engineOptionsFrom;
export const READER_ADDRESS_SECRET_ENVIRONMENT_VARIABLE: "SERVABLE_READER_ADDRESS_SECRET";
export const READER_ADDRESS_SECRET_MINIMUM_LENGTH: 32;
export function readerAddressSecretFrom({ engineConfiguration, env }?: {
    engineConfiguration?: Record<string, any>;
    env?: Record<string, string | undefined>;
}): string | null;
