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
