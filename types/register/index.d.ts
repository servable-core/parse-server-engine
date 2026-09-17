declare function _default({ servableConfig }: {
    servableConfig: any;
}): Promise<{
    Object: any;
    Query: typeof Query;
    Cloud: typeof import("parse/types/Cloud.js");
    User: typeof import("parse").User;
    Role: typeof import("parse").Role;
    File: typeof import("parse").File;
    Installation: typeof import("parse").Installation;
    LiveQuery: typeof import("parse").LiveQuery;
    Session: typeof import("parse").Session;
    Schema: typeof import("parse").Schema;
    Config: typeof import("parse").Config;
    ACL: typeof import("parse").ACL;
    Transaction: {
        new (options?: {}): {
            _state: string;
            _token: any;
            _options: {};
            _writes: number;
            _pending: {
                save: any[];
                destroy: any[];
            };
            _mode: string;
            get state(): string;
            get token(): any;
            get writes(): number;
            get options(): {};
            get mode(): string;
            _assertOpen(): void;
            _assertSingleKind(kind: any): void;
            toWriteOptions(options?: {
                context?: Record<string, any>;
                [key: string]: any;
            }): {
                context: {
                    servableTransactionToken: any;
                };
                transaction: boolean;
            };
            enqueueSave(objects: any): void;
            enqueueDestroy(objects: any): void;
            _enqueue(kind: any, objects: any): void;
            commit(): Promise<{
                token: any;
                writes: number;
                state: string;
                mode: string;
            }>;
            _commitBatch({ kind, objects }: {
                kind: "save" | "destroy";
                objects: any[];
            }): Promise<boolean>;
            _commitSequentially({ kind, objects }: {
                kind: any;
                objects: any;
            }): Promise<void>;
            rollback(): Promise<{
                token: any;
                discarded: number;
                state: string;
                mode: string;
            }>;
            __servableTransactionMarker: boolean;
        };
        _servableConfig: any;
        isTransaction(value: any): boolean;
    };
    Route: {
        define(options: any): Promise<any[]>;
    };
    Jobs: {
        define(payload: any): Promise<void>;
    };
    Utils: typeof import("./parse/utils/index.js");
}>;
export default _default;
import Query from './query/index.js';
