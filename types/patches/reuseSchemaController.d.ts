export function reuseTheSchemaControllerIn({ DatabaseController, schemaCache, now, mostMillisecondsReused }: {
    DatabaseController: any;
    schemaCache: {
        all: () => any[];
    };
    now?: () => number;
    mostMillisecondsReused?: number;
}): {
    timesReused: () => number;
    restore: () => void;
};
export function installTheSchemaControllerReuse({ isEnabled, loadDatabaseController, loadSchemaCache, }: {
    isEnabled: boolean;
    loadDatabaseController?: () => Promise<any>;
    loadSchemaCache?: () => Promise<any>;
}): Promise<{
    isInstalled: boolean;
    reason?: string;
}>;
