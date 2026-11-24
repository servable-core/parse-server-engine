export { compiledBodyDeclarationOf };
export function descriptionOfBodyValue(value: any): string;
export function checkedBodyValueOf({ value, declaration, path }: {
    value: any;
    declaration: any;
    path: string;
}): {
    value: any;
    problems: string[];
};
export function checkedBodyOf({ body, fields, everyOtherField }: {
    body: Record<string, any>;
    fields: Record<string, any>;
    everyOtherField?: any;
}): {
    values: Record<string, any>;
    problems: string[];
};
export function parsedBodyOf(rawBody: any): Record<string, any>;
import { compiledBodyDeclarationOf } from './declaration.js';
