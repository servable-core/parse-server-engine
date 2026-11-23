export const ROUTE_CACHE_BYPASS_HEADER: "x-servable-reset-cache";
export const ROUTE_CACHE_BYPASS_REQUEST_FLAG: "shouldBypassTheRouteCache";
export function isTheBypassSecret(providedValue: unknown, bypassSecret: string | null | undefined): boolean;
export function isRouteCacheBypassedFor({ request, bypassSecret }: {
    request: any;
    bypassSecret: string | null | undefined;
}): boolean;
export default isRouteCacheBypassedFor;
