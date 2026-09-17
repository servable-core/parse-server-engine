export { COLLECTIONS } from "./collections.js";
export function resolveDatabaseURI(servableConfig: any): any;
export function ensureIndexes(db: any): Promise<[any, any, any]>;
export function createStateStoreForDb(db: any): {
    schemaState: {
        get: ({ key }: {
            key: any;
        }) => any;
        recordApplied: ({ key, artifactHash, compatibilityFloor }: {
            key: any;
            artifactHash: any;
            compatibilityFloor: any;
        }) => Promise<any>;
    };
    bootState: {
        get: ({ kind, type, entityId }: {
            kind: any;
            type: any;
            entityId: any;
        }) => Promise<any>;
        /**
         * @param {object} props
         * @param {'seed' | 'config'} props.kind
         * @param {string} props.type
         * @param {string} props.entityId
         * @param {{ createdAt?: Date, [key: string]: any }} [props.fields]
         */
        save: ({ kind, type, entityId, fields }: {
            kind: "seed" | "config";
            type: string;
            entityId: string;
            fields?: {
                createdAt?: Date;
                [key: string]: any;
            };
        }) => Promise<any>;
    };
};
declare function _default({ servableConfig }?: {
    servableConfig?: Record<string, any>;
}): Promise<ReturnType<typeof createStateStoreForDb>>;
export default _default;
