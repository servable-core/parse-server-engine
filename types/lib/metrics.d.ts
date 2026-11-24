export function engineCounterNamed(name: string, options?: {
    description?: string;
}): {
    name: string;
    add: (value?: number, attributes?: Record<string, string | number | boolean>) => void;
};
