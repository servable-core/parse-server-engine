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
