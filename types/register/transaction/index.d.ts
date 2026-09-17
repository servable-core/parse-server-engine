declare function _default({ Parse, servableConfig }: {
    Parse: any;
    servableConfig: any;
}): {
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
        /** @param {{ context?: Record<string, any>, [key: string]: any }} [options] */
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
        /**
         * @param {object} props
         * @param {'save' | 'destroy'} props.kind
         * @param {any[]} props.objects
         * @returns {Promise<boolean>} true if it fell back to a sequential (non-atomic) commit.
         */
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
export default _default;
