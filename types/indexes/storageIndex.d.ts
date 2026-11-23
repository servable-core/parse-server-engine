export function problemsOfTheDeclaration(declaration: any): string[];
export function storageIndexFrom({ className, name, declaration, declaredFields, transformKey }: {
    className: string;
    name: string;
    declaration: any;
    declaredFields?: Record<string, any>;
    transformKey: (className: string, fieldName: string, schema: {
        fields: Record<string, any>;
    }) => string;
}): {
    keys: Record<string, number>;
    options: Record<string, any>;
};
