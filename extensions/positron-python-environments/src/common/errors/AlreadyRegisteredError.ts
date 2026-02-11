import { BaseError } from './types';

export class EnvironmentManagerAlreadyRegisteredError extends BaseError {
    constructor(message: string) {
        super('InvalidArgument', message);
    }
}

export class PackageManagerAlreadyRegisteredError extends BaseError {
    constructor(message: string) {
        super('InvalidArgument', message);
    }
}
