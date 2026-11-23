declare function _default({ url, options, routeParametersReader, rateLimiter, servableArguments, }: {
    url: string;
    options: any;
    rateLimiter: (props: {
        rateLimiting: any;
        routeKey?: string;
    }) => import("express").RequestHandler;
    servableArguments?: any;
    routeParametersReader?: any;
}): Promise<void>;
export default _default;
