export function isConnectMethod(method: unknown): boolean;
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
