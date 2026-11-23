declare function _default({ servableArguments, extra, routeParametersReader, options: { handler, requireUser, requireStepUp }, request, response, next }: {
    servableArguments: any;
    extra?: {};
    routeParametersReader: any;
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
