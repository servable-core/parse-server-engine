export function reportTheEngineOptions({ engineOptions, routeCacheBypassSecret, logger }: {
    engineOptions: Record<string, boolean>;
    routeCacheBypassSecret: string | null;
    logger?: {
        info: (...args: any[]) => void;
    };
}): Record<string, any>;
export default reportTheEngineOptions;
