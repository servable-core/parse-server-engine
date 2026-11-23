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
}
export function booleanFromEnvironmentValue(rawValue: unknown): boolean | undefined;
export function engineOptionsFrom({ engineConfiguration, env }?: {
    engineConfiguration?: Record<string, any>;
    env?: Record<string, string | undefined>;
}): {
    isFastObjectGetEnabled: boolean;
    isSchemaControllerReuseEnabled: boolean;
    areDeclaredIndexesEnsured: boolean;
};
export const ROUTE_CACHE_BYPASS_SECRET_ENVIRONMENT_VARIABLE: "SERVABLE_CACHE_BYPASS_SECRET";
export const ROUTE_CACHE_BYPASS_SECRET_MINIMUM_LENGTH: 16;
export function routeCacheBypassSecretFrom({ engineConfiguration, env }?: {
    engineConfiguration?: Record<string, any>;
    env?: Record<string, string | undefined>;
}): string | null;
export default engineOptionsFrom;
