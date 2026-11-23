declare function _default({ duration, template, bypassSecret, store }: {
    duration: number;
    template?: string | null;
    bypassSecret?: string | null;
    store?: {
        get: (key: string) => any;
        put: (key: string, value: any, ttl: number) => any;
    };
}): (req: any, res: any, next: any) => void;
export default _default;
