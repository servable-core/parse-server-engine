export function createRouteParametersReader({ queryStringDeclaration, isQueryValueGuessingEnabled, areDeclaredRouteParametersTyped, bodyDeclaration, areDeclaredRouteBodiesChecked, isBodyParsed, routeName, reportDeclarationProblem, }: {
    queryStringDeclaration: any;
    isQueryValueGuessingEnabled: boolean;
    areDeclaredRouteParametersTyped: boolean;
    bodyDeclaration?: any;
    areDeclaredRouteBodiesChecked?: boolean;
    isBodyParsed?: boolean;
    routeName?: string;
    reportDeclarationProblem?: (...message: any[]) => void;
}): {
    isDeclared: boolean;
    isWildcardGuessed: boolean;
    isBodyDeclared: boolean;
    readQueryOf: (request: {
        originalUrl?: string;
        url?: string;
    }) => Record<string, any>;
    readBodyOf: (request: {
        body?: any;
    }) => Record<string, any> | undefined;
};
export { recordUndeclaredRoute, undeclaredParameterRoutes, forgetUndeclaredParameterRoutes, doesHandlerSeemToReadParameters, recordDefinedRouteParameters, reportTheRouteParametersSummarySoon } from "./bootReport.js";
