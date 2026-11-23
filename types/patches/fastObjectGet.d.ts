export function fastGetOver(getOfTheSdk: (this: any, attr: any) => any): (this: any, attr: any) => any;
export function installTheFastObjectGetIn({ ParseObject }: {
    ParseObject: any;
}): {
    isInstalled: boolean;
    reason?: string;
    restore: () => void;
};
export function installTheFastObjectGet({ isEnabled, loadParseObject, }: {
    isEnabled: boolean;
    loadParseObject?: () => Promise<any>;
}): Promise<{
    isInstalled: boolean;
    reason?: string;
}>;
