export function engineCounterNamed(name: string, options?: {
    description?: string;
}): {
    name: string;
    add: (value?: number, attributes?: Record<string, string | number | boolean>) => void;
};
export function engineHistogramNamed(name: string, options?: {
    description?: string;
    bucketBoundaries?: number[];
}): {
    name: string;
    record: (value: number, attributes?: Record<string, string | number | boolean>) => void;
};
