export const ROUTE_DURATION_BUCKETS_IN_SECONDS: readonly number[];
export function isRouteDurationMeasured(routeOptions: any): boolean;
export function statusClassOf(statusCode: unknown): string;
export function routeDurationMiddlewareOf({ routeOptions, routePath, method, nowInMilliseconds }: {
    routeOptions: any;
    routePath: string;
    method: string;
    nowInMilliseconds?: () => number;
}): (req: any, res: any, next: any) => void;
export default routeDurationMiddlewareOf;
