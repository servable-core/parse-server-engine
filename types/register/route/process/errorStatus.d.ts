export function httpStatusOfErrorCode(code: unknown): number;
export function remappedKindOfErrorCode(code: unknown): "parse_1xx" | "negative" | "mongo" | "not_integer" | null;
export function httpStatusOfThrownErrorCode(code: unknown): number;
export default httpStatusOfErrorCode;
