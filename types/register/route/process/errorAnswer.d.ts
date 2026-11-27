export function refusalCodeOfThrownError(error: unknown): string | null;
export function sendableRefusalDetailsOfThrownError(error: unknown): Record<string, unknown> | null;
export function errorAnswerBodyOf({ message, code, thrownError }: {
    message: string;
    code: unknown;
    thrownError: unknown;
}): {
    error: string;
    code: unknown;
    refusalCode?: string;
    refusalDetails?: Record<string, unknown>;
};
export default errorAnswerBodyOf;
