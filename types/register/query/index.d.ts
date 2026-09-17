declare const Query_base: typeof import("parse").Query;
export default class Query extends Query_base {
    static or(...queries: any[]): Query;
    static and(...queries: any[]): Query;
    static nor(...queries: any[]): Query;
    constructor(objectClass: string | (new (...args: any[]) => import("parse").Object<import("parse/types/ParseObject.js").Attributes>));
    find(options: any): Promise<import("parse").Object<import("parse/types/ParseObject.js").Attributes>[]>;
    first(options: any): Promise<import("parse").Object<import("parse/types/ParseObject.js").Attributes>>;
    get(objectId: any, options: any): Promise<import("parse").Object<import("parse/types/ParseObject.js").Attributes>>;
    count(options: any): Promise<number>;
    each(callback: any, options: any): Promise<void>;
    eachBatch(callback: any, options: any): Promise<void>;
    map(callback: any, options: any): Promise<any[]>;
    reduce(callback: any, initial: any, options: any): Promise<any[]>;
    filter(callback: any, options: any): Promise<import("parse").Object<import("parse/types/ParseObject.js").Attributes>[]>;
}
export {};
