/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Similar to the `DeferredPromise` pattern in VS Code, `PromiseHandles` is a
 * promise with exposed and imperatively callable resolve and reject methods.
 */
export class PromiseHandles<T> {
	resolve!: (value: T | Promise<T>) => void;
	reject!: (error: unknown) => void;
	settled: boolean = false;
	promise: Promise<T>;

	constructor() {
		this.promise = new Promise((resolve, reject) => {
			this.resolve = (val) => {
				this.settled = true;
				resolve(val);
			};
			this.reject = (reason) => {
				this.settled = true;
				reject(reason);
			};
		});
	}
}

export function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wraps a promise in a timeout that rejects the promise if it does not resolve
 * within the given time.
 *
 * @param promise The promise to wrap
 * @param timeout The timeout interval in milliseconds
 * @param message The error message to use if the promise times out
 *
 * @returns The wrapped promise
 */
export function withTimeout<T>(promise: Promise<T>,
	timeout: number,
	message: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), timeout))
	]);
}

/**
 * Creates a uuidv4 string. We use this to create message and comm identifiers
 * instead of using the popular uuid Node package, since the uuid package relies
 * on `getRandomValues()` which, while cryptographically secure, is not
 * available everywhere.
 *
 * The values returned are unique, but not cryptographically secure, which is
 * fine for our purposes.
 *
 * @returns A unique (but not cryptographically secure) UUIDv4 string
 */
export function uuidv4() {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
		const r = Math.random() * 16 | 0;
		const v = c === 'x' ? r : (r & 0x3 | 0x8);
		return v.toString(16);
	});
}
