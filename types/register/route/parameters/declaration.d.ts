export const PARAMETER_TYPES: string[];
export const EVERY_OTHER_PARAMETER: "*";
export function normalizedDeclarationOf({ declaration, path }: {
    declaration: any;
    path: string;
}): {
    declaration: RouteParameterDeclaration | null;
    problems: string[];
};
export function compiledQueryStringDeclarationOf({ queryStringDeclaration }: {
    queryStringDeclaration: any;
}): {
    parameters: Record<string, RouteParameterDeclaration>;
    everyOtherParameter?: RouteParameterDeclaration | null;
    problems: string[];
};
export type RouteParameterDeclaration = {
    type: "boolean" | "integer" | "number" | "string" | "array" | "object" | "any" | "guessed";
    /**
     * - the value the handler gets when the request does not give one.
     */
    default?: any;
    /**
     * - the only values accepted, after the value is read as its type.
     */
    enum?: any[];
    /**
     * - a request without it is refused (400); meaningless with a `default`.
     */
    isRequired?: boolean;
    description?: string;
    /**
     * - integer and number.
     */
    minimum?: number;
    /**
     * - integer and number.
     */
    maximum?: number;
    /**
     * - string.
     */
    minLength?: number;
    /**
     * - string.
     */
    maxLength?: number;
    /**
     * - array: the type of each item (text when not declared).
     */
    items?: RouteParameterDeclaration | string;
    /**
     * - array.
     */
    minItems?: number;
    /**
     * - array.
     */
    maxItems?: number;
    /**
     * - object: its declared properties.
     */
    properties?: Record<string, RouteParameterDeclaration | string>;
};
