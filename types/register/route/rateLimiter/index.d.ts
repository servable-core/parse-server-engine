declare function _default({ rateLimiting, routeKey }: {
    routeKey?: string;
    rateLimiting?: {
        type?: "fixedByIp";
        params?: {
            limit?: number;
            window?: number;
            message?: string;
            standardHeaders?: boolean;
            legacyHeaders?: boolean;
        };
    };
}): import("express-rate-limit").RateLimitRequestHandler | typeof import("../empty.js").default;
export default _default;
