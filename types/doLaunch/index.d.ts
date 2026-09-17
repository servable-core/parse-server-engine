declare function _default({ config, serverCloseComplete, app }: {
    config: {
        parse: Record<string, any>;
    };
    serverCloseComplete?: () => any;
    app: import("express").Express;
}): Promise<any>;
export default _default;
