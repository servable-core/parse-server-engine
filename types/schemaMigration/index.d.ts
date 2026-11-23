export function parseServerVersionOf(): string | null;
export function stableStringify(value: any): string;
export function definitionsHashOf({ definitions, schemaOptions, parseServerVersion }: {
    definitions: Array<Record<string, any>>;
    schemaOptions?: Record<string, any>;
    parseServerVersion?: string | null;
}): string;
export function databaseSchemaHashOf({ db, collectionPrefix }: {
    db: import("mongodb").Db;
    collectionPrefix?: string;
}): Promise<string>;
export function schemaMigrationDecisionOf({ isForced, definitionsHash, databaseSchemaHash, lastCompletedMigration }: {
    isForced: boolean;
    definitionsHash: string;
    databaseSchemaHash: string | null;
    lastCompletedMigration: {
        definitionsHash?: string;
        databaseSchemaHash?: string;
        hasChangedNothing?: boolean;
    } | null;
}): {
    isMigrationRun: boolean;
    reason: string;
};
export function lastCompletedMigrationStoreOf(db: import("mongodb").Db): {
    read: () => Promise<{
        definitionsHash?: string;
        databaseSchemaHash?: string;
        hasChangedNothing?: boolean;
    } | null>;
    record: ({ definitionsHash, databaseSchemaHash, hasChangedNothing, parseServerVersion }: {
        definitionsHash: any;
        databaseSchemaHash: any;
        hasChangedNothing: any;
        parseServerVersion: any;
    }) => Promise<import("mongodb").UpdateResult>;
};
export function installTheMigrationControls(DefinedSchemas?: any): {
    isInstalled: boolean;
    reason?: string;
};
export function controlTheMigrationOf(schemaOptions: object, controls: {
    isSkipped: boolean;
    onCompleted?: () => void;
    onSkipped?: () => void;
}): void;
export function planTheSchemaMigration({ db, definitions, schemaOptions, collectionPrefix, isForced, areControlsInstalled }: {
    db: import("mongodb").Db | null;
    definitions: Array<Record<string, any>>;
    schemaOptions: Record<string, any>;
    collectionPrefix?: string;
    isForced: boolean;
    areControlsInstalled: boolean;
}): Promise<{
    isMigrationRun: boolean;
    reason: string;
    definitionsHash: string;
    parseServerVersion: string;
} | {
    definitionsHash: string;
    databaseSchemaHashBefore: string;
    parseServerVersion: string;
    isMigrationRun: boolean;
    reason: string;
}>;
export function recordTheCompletedMigration({ db, plan, hasCompleted, collectionPrefix }: {
    db: import("mongodb").Db | null;
    plan: {
        definitionsHash: string;
        databaseSchemaHashBefore?: string | null;
        parseServerVersion: string | null;
    };
    hasCompleted: boolean;
    collectionPrefix?: string;
}): Promise<{
    isRecorded: boolean;
    hasChangedNothing?: boolean;
    reason?: string;
}>;
