export const ERROR_ANSWER_LOCALS_FLAG: "isAnErrorAnswer";
export function isAnswerCacheable(response: any): boolean;
export function markAnswerAsAnError(response: any): void;
export function keepTheAnswerOf({ response, keepAnswer, onAnswerNotKept }: {
    response: any;
    keepAnswer: (answer: CachedAnswer) => void;
    onAnswerNotKept?: () => void;
}): void;
export function replayAnswer({ response, answer }: {
    response: any;
    answer: CachedAnswer;
}): any;
export function redisEntryOf({ status, contentType, body }: CachedAnswer): string;
export function answerOfRedisEntry(entry: unknown): CachedAnswer | null;
export type CachedAnswer = {
    status: number;
    contentType: string | null;
    body: string | Buffer;
};
