export function queryStringOfUrl(url: string | undefined | null): string;
export function rawQueryOf(queryString: string | undefined | null): Record<string, any>;
export function guessedValueOf(text: string): string | number | boolean;
export function guessedQueryValuesOf(rawValue: any): any;
export function createQueryParser({ isQueryValueGuessingEnabled }: {
    isQueryValueGuessingEnabled: boolean;
}): (queryString: string) => Record<string, any>;
