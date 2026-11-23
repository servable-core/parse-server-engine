export const ENGINE_OWNED_ENSURED_INDEXES: {
    className: string;
    ensuredIndexes: {
        _session_token_1: {
            keys: {
                sessionToken: number;
            };
            isUnique: boolean;
        };
    };
}[];
export function withTheEngineOwnedIndexes(classes: any[] | null | undefined, engineOwnedClasses?: any[]): any[];
