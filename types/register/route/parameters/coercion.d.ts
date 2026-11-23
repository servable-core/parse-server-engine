export function quotedValueOf(value: any): string;
export function isRawValueEmptyFor({ rawValue, declaration }: {
    rawValue: any;
    declaration: {
        type: string;
    };
}): boolean;
export function problemOfTypedValue({ value, declaration }: {
    value: any;
    declaration: any;
}): string | null;
export function copyOfDefault(value: any): any;
export function coercedValueOf({ rawValue, declaration, path }: {
    rawValue: any;
    declaration: any;
    path: string;
}): {
    value: any;
    problem?: undefined;
} | {
    problem: string;
    value?: undefined;
};
export function readDeclaredValues({ rawValues, declarations, readUndeclaredValue, pathPrefix }: {
    rawValues: Record<string, any>;
    declarations: Record<string, any>;
    readUndeclaredValue: (rawValue: any) => any;
    pathPrefix?: string;
}): {
    values: Record<string, any>;
    problems: string[];
};
