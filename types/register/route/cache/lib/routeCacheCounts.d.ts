export function routeCacheBypassOutcomeOf({ request, bypassSecret }: {
    request: any;
    bypassSecret: string | null | undefined;
}): "bypass_in_process" | "bypass_secret" | null;
export function isTheBypassHeaderRefusedFor(request: any): boolean;
export function countTheRouteCacheLookup({ routePath, storage, outcome }: {
    routePath?: string | null;
    storage: string;
    outcome: string;
}): void;
export function countTheRouteCacheStore({ routePath, storage, outcome }: {
    routePath?: string | null;
    storage: string;
    outcome: string;
}): void;
