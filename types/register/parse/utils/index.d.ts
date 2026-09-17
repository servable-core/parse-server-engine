export function getOnePlain(props: {
    objectId: string;
    className: string;
    useMasterKey?: boolean;
}): Promise<any>;
export function formatQuery(props: {
    query: any;
    options: {
        sort?: "asc" | "desc";
        limit?: number;
        skip?: number;
        page?: number;
        withCount?: boolean;
    };
}): void;
export function getOneGeneric({ objectId, className, include }?: {
    objectId?: string;
    className?: string;
    include?: string | string[];
}): Promise<any>;
export function performBatchOnQuery({ query, batchSize, action }: {
    query: any;
    batchSize?: number;
    action: (item: any) => any;
}): Promise<void>;
export function fetchObjectIfNeeded({ object, className, forceFetch, includes, excludes, useMasterKey }?: {
    object?: any;
    className?: string;
    forceFetch?: boolean;
    includes?: string[];
    excludes?: string[];
    useMasterKey?: boolean;
}): Promise<any>;
export function fetchObject({ objectId, className, forceFetch, includes, excludes, useMasterKey }?: {
    objectId?: string;
    className?: string;
    forceFetch?: boolean;
    includes?: string[];
    excludes?: string[];
    useMasterKey?: boolean;
}): Promise<any>;
export function destroyRowsWithQuery({ query, limitPerBatch }?: {
    query?: any;
    limitPerBatch?: number;
}): Promise<number>;
export function destroyAllRowsWithQuery({ query, limitPerBatch }?: {
    query?: any;
    limitPerBatch?: number;
}): any;
export function prepareRequestWithUser({ params, headers, user, fetchOptions }?: {
    params?: {
        masterKey?: string;
        userID?: string;
    };
    headers?: Record<string, string>;
    user?: any;
    fetchOptions?: {
        includes?: string[];
        excludes?: string[];
    };
}): Promise<any>;
export function destroyItems({ object, keys }: {
    object: any;
    keys: string[];
}): Promise<any[]>;
export function destroyItem(props: {
    object: any;
    key: string;
}): Promise<any>;
export function destroyItemsInArray(props: {
    object: any;
    key: string;
}): Promise<any[]>;
export function saveFileDataToFS({ file, path }: {
    file: any;
    path?: string;
}): Promise<string>;
