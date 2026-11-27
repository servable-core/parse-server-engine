export const READER_ADDRESS_HEADER: "x-servable-reader-address";
export const READER_ADDRESS_FORMAT_VERSION: "v1";
export const READER_ADDRESS_MAXIMUM_AGE_SECONDS: 60;
export const READER_ADDRESS_MAXIMUM_CLOCK_AHEAD_SECONDS: 10;
export const READER_ADDRESS_REQUEST_PROPERTY: "servableReaderAddress";
export const IS_READER_ADDRESS_SIGNED_REQUEST_PROPERTY: "isServableReaderAddressSigned";
export function plainIpAddressOf(value: unknown): string | null;
export function readerAddressSignatureOf({ address, signedAtSeconds, secret }: {
    address: string;
    signedAtSeconds: number;
    secret: string;
}): string;
export function signedReaderAddressHeaderValueOf({ address, secret, nowSeconds }: {
    address: string;
    secret: string | null | undefined;
    nowSeconds?: number;
}): string | null;
export function checkedReaderAddressOf({ headerValue, secret, nowSeconds }: {
    headerValue: unknown;
    secret: string | null | undefined;
    nowSeconds?: number;
}): {
    outcome: "absent" | "no_secret" | "malformed" | "refused" | "expired" | "verified";
    address: string | null;
};
export function readerAddressOfRequest(request: any): string;
export function readerAddressMiddlewareOf({ secret, now }: {
    secret: string | null | undefined;
    now?: () => number;
}): (request: any, response: any, next: () => void) => void;
export default readerAddressMiddlewareOf;
