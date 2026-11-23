export function createRouteParametersReader({ queryStringDeclaration, isQueryValueGuessingEnabled, areDeclaredRouteParametersTyped, routeName, reportDeclarationProblem, }: {
    queryStringDeclaration: any;
    isQueryValueGuessingEnabled: boolean;
    areDeclaredRouteParametersTyped: boolean;
    routeName?: string;
    reportDeclarationProblem?: (...message: any[]) => void;
}): {
    isDeclared: boolean;
    readQueryOf: (request: {
        originalUrl?: string;
        url?: string;
    }) => Record<string, any>;
};
export { recordUndeclaredRoute, undeclaredParameterRoutes, forgetUndeclaredParameterRoutes, doesHandlerSeemToReadParameters } from "./bootReport.js";
