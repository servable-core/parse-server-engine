declare function _default({ servableArguments, extra, options: { handler, requireUser, requireStepUp }, request, response, next }: {
    servableArguments: any;
    extra?: {};
    options: {
        handler: any;
        requireUser?: boolean;
        requireStepUp?: boolean;
    };
    request: any;
    response: any;
    next: any;
}): Promise<void>;
export default _default;
