declare function _default({ ObjectClass, QueryClass }: {
    ObjectClass: any;
    QueryClass: any;
}): {
    /** @param {string} className */
    object: (className: string) => any;
    /** @param {string} className */
    query: (className: string) => any;
};
export default _default;
