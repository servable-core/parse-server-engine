export function doesHandlerSeemToReadParameters(handler: any): boolean;
export function recordUndeclaredRoute({ routeName, handler }: {
    routeName: string;
    handler: any;
}): {
    routeName: string;
    doesSeemToReadParameters: boolean;
};
export function undeclaredParameterRoutes(): {
    routeName: string;
    doesSeemToReadParameters: boolean;
}[];
export function forgetUndeclaredParameterRoutes(): void;
export function undeclaredParameterRoutesSummary(): string | null;
export function reportTheUndeclaredParameterRoutesSoon({ writeLine }?: {
    writeLine?: (line: string) => void;
}): void;
export function recordDefinedRouteParameters({ isDeclared, isWildcardGuessed, doesSeemToReadParameters }: {
    isDeclared: boolean;
    isWildcardGuessed?: boolean;
    doesSeemToReadParameters?: boolean;
}): void;
export function routeParametersSummaryOf({ isQueryValueGuessingEnabled, areDeclaredRouteParametersTyped }: {
    isQueryValueGuessingEnabled: boolean;
    areDeclaredRouteParametersTyped: boolean;
}): {
    proof: string;
    routes: number;
    declared: number;
    undeclared: number;
    undeclaredReading: number;
    wildcardGuessed: number;
    isQueryValueGuessingEnabled: boolean;
    areDeclaredRouteParametersTyped: boolean;
};
export function reportTheRouteParametersSummarySoon({ isQueryValueGuessingEnabled, areDeclaredRouteParametersTyped, logger }: {
    isQueryValueGuessingEnabled: boolean;
    areDeclaredRouteParametersTyped: boolean;
    logger?: {
        info: (...args: any[]) => void;
    };
}): void;
export function forgetDefinedRouteParameters(): void;
