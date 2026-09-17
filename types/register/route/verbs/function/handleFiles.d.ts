declare function _default({ url, options, rateLimiter, servableArguments, }: {
    url: string;
    options: any;
    rateLimiter: (props: {
        rateLimiting: any;
    }) => import("express").RequestHandler;
    servableArguments?: any;
}): Promise<void>;
export default _default;
