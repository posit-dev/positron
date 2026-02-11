import { BaseError } from './types';

export class CreateEnvironmentNotSupported extends BaseError {
    constructor(message: string) {
        super('NotSupported', message);
    }
}

export class RemoveEnvironmentNotSupported extends BaseError {
    constructor(message: string) {
        super('NotSupported', message);
    }
}
