export function reportSessionInvalidation(invalidation: SessionInvalidation): void;
export function invalidationOfWrite(operation: "update" | "destroy", className: string, query: any): SessionInvalidation | null;
export function reportWritesOf(DatabaseController: any): () => void;
export function reportDeletedUserCacheEntriesOf(userCache: any): void;
export function installTheSessionInvalidationReports({ applicationIdOf, loadConfig, loadDatabaseController, }: {
    applicationIdOf: () => string | undefined;
    loadConfig?: () => Promise<any>;
    loadDatabaseController?: () => Promise<any>;
}): Promise<{
    isReported: boolean;
    reason?: string;
}>;
export function createSessionInvalidations({ applicationIdOf }: {
    applicationIdOf: () => string | undefined;
}): {
    /**
     * @param {(invalidation: SessionInvalidation) => void} listener
     * @returns {Promise<{ isReported: boolean, reason?: string, unsubscribe: () => void }>}
     */
    subscribe: (listener: (invalidation: SessionInvalidation) => void) => Promise<{
        isReported: boolean;
        reason?: string;
        unsubscribe: () => void;
    }>;
};
export function resetSessionInvalidationsForTests(): void;
export type SessionInvalidation = {
    sessionToken?: string;
    sessionId?: string;
    userId?: string;
    isEverything?: boolean;
};
