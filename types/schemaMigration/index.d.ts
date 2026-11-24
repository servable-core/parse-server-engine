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
export function declaredIndexNamesByClassOf(definitions: Array<Record<string, any>>): Record<string, string[]>;
export function isIndexProtectedFromTheMigration({ className, indexName, declaredIndexNamesByClass, previouslyDeclaredIndexNamesByClass }: {
    className: string;
    indexName: string;
    declaredIndexNamesByClass: Record<string, string[]>;
    previouslyDeclaredIndexNamesByClass: Record<string, string[]> | null | undefined;
}): boolean;
export function lastCompletedMigrationStoreOf(db: import("mongodb").Db): {
    read: () => Promise<{
        definitionsHash?: string;
        databaseSchemaHash?: string;
        hasChangedNothing?: boolean;
        declaredIndexNamesByClass?: Record<string, string[]>;
    } | null>;
    record: ({ definitionsHash, databaseSchemaHash, hasChangedNothing, parseServerVersion, declaredIndexNamesByClass }: {
        definitionsHash: any;
        databaseSchemaHash: any;
        hasChangedNothing: any;
        parseServerVersion: any;
        declaredIndexNamesByClass: any;
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
    isIndexProtected?: (className: string, indexName: string) => boolean;
}): void;
export function migrationControlsOf({ plan, onCompleted }: {
    plan: {
        isMigrationRun: boolean;
        declaredIndexNamesByClass?: Record<string, string[]>;
        previouslyDeclaredIndexNamesByClass?: Record<string, string[]> | null;
    };
    onCompleted?: () => void;
}): {
    isSkipped: boolean;
    onCompleted: () => void;
    isIndexProtected: (className: string, indexName: string) => boolean;
};
export function planTheSchemaMigration({ db, definitions, schemaOptions, collectionPrefix, isForced, areControlsInstalled }: {
    db: import("mongodb").Db | null;
    definitions: Array<Record<string, any>>;
    schemaOptions: Record<string, any>;
    collectionPrefix?: string;
    isForced: boolean;
    areControlsInstalled: boolean;
}): Promise<{
    definitionsHash: string;
    parseServerVersion: string;
    declaredIndexNamesByClass: Record<string, string[]>;
    previouslyDeclaredIndexNamesByClass: any;
    isMigrationRun: boolean;
    reason: string;
} | {
    databaseSchemaHashBefore: string;
    previouslyDeclaredIndexNamesByClass: Record<string, string[]>;
    definitionsHash: string;
    parseServerVersion: string;
    declaredIndexNamesByClass: Record<string, string[]>;
    isMigrationRun: boolean;
    reason: string;
}>;
export function recordTheCompletedMigration({ db, plan, hasCompleted, collectionPrefix }: {
    db: import("mongodb").Db | null;
    plan: {
        definitionsHash: string;
        databaseSchemaHashBefore?: string | null;
        parseServerVersion: string | null;
        declaredIndexNamesByClass?: Record<string, string[]>;
    };
    hasCompleted: boolean;
    collectionPrefix?: string;
}): Promise<{
    isRecorded: boolean;
    hasChangedNothing?: boolean;
    reason?: string;
}>;
