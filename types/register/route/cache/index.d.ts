declare function _default({ cache, bypassSecret, routePath }: {
    cache?: any;
    bypassSecret?: string | null;
    routePath?: string | null;
}): (req: any, res: any, next: any) => void;
export default _default;
