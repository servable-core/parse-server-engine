export function createIndexes({ resolveAdapter, loadTransformKey, declaredClasses, }: {
    resolveAdapter: () => Promise<any>;
    loadTransformKey?: () => Promise<(className: string, fieldName: string, schema: any) => string>;
    declaredClasses?: () => any[] | null | undefined;
}): {
    ensure: ({ className, name, keys, isUnique, isSparse, partialFilter, fieldTypes }: {
        className: string;
        name: string;
        keys: Record<string, 1 | -1>;
        isUnique?: boolean;
        isSparse?: boolean;
        partialFilter?: Record<string, any>;
        fieldTypes?: Record<string, any>;
    }) => Promise<{
        isEnsured: boolean;
        className: string;
        name: string;
        reason?: string;
    }>;
    ensureTheDeclared: ({ classes, now }: {
        classes: any[];
        now?: () => number;
    }) => Promise<{
        ensured: string[];
        failed: {
            index: string;
            reason: string;
        }[];
    }>;
};
export function adapterResolverFor(applicationIdOf: () => string | undefined): () => Promise<any>;
export function startEnsuringTheDeclaredIndexes({ indexes, classes, areDeclaredIndexesEnsured, engineOwnedClasses }: {
    indexes: {
        ensureTheDeclared: (props: {
            classes: any[];
        }) => Promise<any>;
    };
    classes: any[];
    areDeclaredIndexesEnsured: boolean;
    engineOwnedClasses?: any[];
}): Promise<any> | null;
export default createIndexes;
