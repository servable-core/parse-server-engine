export function isConnectMethod(method: unknown): boolean;
export function doesRouteParseAJsonBody({ method, hasFiles }: {
    method: unknown;
    hasFiles: boolean;
}): boolean;
declare function _default({ servableConfig }: {
    servableConfig: any;
}): {
    undeclaredParameterRoutes: () => {
        routeName: string;
        doesSeemToReadParameters: boolean;
    }[];
    define(options: any): Promise<any[]>;
};
export default _default;
