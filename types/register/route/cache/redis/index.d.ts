export function getRedisClient({ redisUrl }: {
    redisUrl: any;
}): Promise<any>;
declare function _default({ duration, template, redisUrl, bypassSecret, getClient }: {
    duration: number;
    template?: string | null;
    redisUrl?: string;
    bypassSecret?: string | null;
    getClient?: () => Promise<any>;
}): (req: any, res: any, next: any) => Promise<void>;
export default _default;
