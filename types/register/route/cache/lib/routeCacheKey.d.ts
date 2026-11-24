export function isPerReaderTemplate(template: string | null | undefined): boolean;
export function routeCacheKeyOf({ request, template }: {
    request: any;
    template: string | null | undefined;
}): string | null;
export default routeCacheKeyOf;
