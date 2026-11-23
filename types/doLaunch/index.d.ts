export const PARSE_SCHEMA_MIGRATION_OPTIONS: Readonly<{
    lockSchemas: true;
    strict: false;
    recreateModifiedFields: false;
    deleteExtraFields: false;
}>;
declare function _default({ config, serverCloseComplete, app, migrationControls }: {
    config: {
        parse: Record<string, any>;
    };
    serverCloseComplete?: () => any;
    app: import("express").Express;
    migrationControls?: {
        isSkipped: boolean;
        onCompleted?: () => void;
        onSkipped?: () => void;
    };
}): Promise<any>;
export default _default;
