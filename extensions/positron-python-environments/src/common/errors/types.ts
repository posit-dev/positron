export type ErrorCategory = 'NotSupported' | 'InvalidArgument';

export abstract class BaseError extends Error {
    constructor(public readonly category: ErrorCategory, message: string) {
        super(message);
        this.name = this.constructor.name;
    }
}
