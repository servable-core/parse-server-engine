/**
 * An express-rate-limit store that counts in Redis so every pod shares one counter per route and visitor
 * (a fixed window: INCR, PEXPIRE on the first hit). Keys are `<prefix><routeKey>:<visitor key>`, so each route's
 * limiter counts on its own.
 *
 * Fails open to an in-memory store of this process: a Redis that cannot be reached, or that is slow, never blocks a
 * request. After a failure Redis is not tried again for a few seconds (so a down Redis adds no delay per request),
 * and the failure is logged at most once a minute.
 *
 * @param {object} props
 * @param {string} props.routeKey identifies the limiter (method and url of its route)
 * @param {() => Promise<any>} props.getClient resolves the Redis client, or null when there is none
 * @param {string} [props.keyPrefix]
 * @param {number} [props.commandTimeoutMs]
 * @param {() => number} [props.now]
 */
export default class RedisRateLimitStore {
    constructor({ routeKey, getClient, keyPrefix, commandTimeoutMs, now }: {
        routeKey: any;
        getClient: any;
        keyPrefix?: string;
        commandTimeoutMs?: number;
        now?: () => number;
    });
    prefix: string;
    localKeys: boolean;
    getClient: any;
    commandTimeoutMs: number;
    now: () => number;
    windowMs: number;
    fallbackStore: MemoryStore;
    breakerOpenUntil: number;
    lastLoggedAt: number;
    init(options: any): void;
    isRedisSkipped(): boolean;
    noteFailure(error: any): void;
    run(script: any, key: any, args?: any[]): Promise<any>;
    increment(key: any): Promise<{
        totalHits: number;
        resetTime: Date;
    }>;
    decrement(key: any): Promise<void>;
    resetKey(key: any): Promise<void>;
    shutdown(): void;
}
import { MemoryStore } from 'express-rate-limit';
