export interface Deferred<T> {
    readonly promise: Promise<T>;
    readonly resolved: boolean;
    readonly rejected: boolean;
    readonly completed: boolean;
    resolve(value?: T | PromiseLike<T>): void;
    reject(reason?: string | Error | Record<string, unknown> | unknown): void;
}

class DeferredImpl<T> implements Deferred<T> {
    promise: Promise<T>;
    private _resolve!: (value: T | PromiseLike<T>) => void;
    private _reject!: (reason?: string | Error | Record<string, unknown> | unknown) => void;
    resolved: boolean = false;
    rejected: boolean = false;
    completed: boolean = false;

    constructor() {
        this.promise = new Promise<T>((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
    }

    resolve(value: T | PromiseLike<T>): void {
        if (!this.completed) {
            this._resolve(value);
            this.resolved = true;
            this.completed = true;
        }
    }

    reject(reason?: string | Error | Record<string, unknown> | unknown): void {
        if (!this.completed) {
            this._reject(reason);
            this.rejected = true;
            this.completed = true;
        }
    }
}

export function createDeferred<T>(): Deferred<T> {
    return new DeferredImpl<T>();
}
