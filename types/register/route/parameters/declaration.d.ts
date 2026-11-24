export const PARAMETER_TYPES: string[];
export const EVERY_OTHER_PARAMETER: "*";
/**
 * @typedef {object} RouteParameterDeclaration
 * @property {'boolean' | 'integer' | 'number' | 'string' | 'array' | 'object' | 'any' | 'guessed'} type
 * @property {any} [default] - the value the handler gets when the request does not give one.
 * @property {any[]} [enum] - the only values accepted, after the value is read as its type.
 * @property {boolean} [isRequired] - a request without it is refused (400); meaningless with a `default`.
 * @property {string} [description]
 * @property {number} [minimum] - integer and number.
 * @property {number} [maximum] - integer and number.
 * @property {number} [minLength] - string.
 * @property {number} [maxLength] - string.
 * @property {RouteParameterDeclaration | string} [items] - array: the type of each item (text when not declared).
 * @property {number} [minItems] - array.
 * @property {number} [maxItems] - array.
 * @property {Record<string, RouteParameterDeclaration | string>} [properties] - object: its declared properties.
 */
export const DECLARATION_SOURCES: string[];
export function normalizedDeclarationOf({ declaration, path, source }: {
    declaration: any;
    path: string;
    source?: "query" | "body";
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
export function compiledBodyDeclarationOf({ bodyDeclaration }: {
    bodyDeclaration: any;
}): {
    fields: Record<string, RouteParameterDeclaration>;
    everyOtherField: RouteParameterDeclaration | null;
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
