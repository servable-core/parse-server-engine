export function cacheKeyWithoutSessionToken(key: unknown): unknown;
export function withSessionTokensHashedInKeys<AdapterClass extends new (...args: any[]) => any>(CacheAdapterClass: AdapterClass): AdapterClass;
