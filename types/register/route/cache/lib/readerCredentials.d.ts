export function readerCredentialsOf(request: any): {
    sessionToken: string | null;
    bearerToken: string | null;
};
export function installationIdOf(request: any): string | null;
export function isSignedInRequest(request: any): boolean;
export function readerCredentialKindOf(request: any): "session" | "bearer" | "session_and_bearer" | null;
export function readerKeyPartOf(request: any): string | null;
