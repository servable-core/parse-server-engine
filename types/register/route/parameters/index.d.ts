export function createRouteParametersReader({ queryStringDeclaration, isQueryValueGuessingEnabled, areDeclaredRouteParametersTyped, routeName, reportDeclarationProblem, }: {
    queryStringDeclaration: any;
    isQueryValueGuessingEnabled: boolean;
    areDeclaredRouteParametersTyped: boolean;
    routeName?: string;
    reportDeclarationProblem?: (...message: any[]) => void;
}): {
    isDeclared: boolean;
    isWildcardGuessed: boolean;
    readQueryOf: (request: {
        originalUrl?: string;
        url?: string;
    }) => Record<string, any>;
};
export { recordUndeclaredRoute, undeclaredParameterRoutes, forgetUndeclaredParameterRoutes, doesHandlerSeemToReadParameters, recordDefinedRouteParameters, reportTheRouteParametersSummarySoon } from "./bootReport.js";
