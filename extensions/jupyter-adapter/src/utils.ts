/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
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

export function uuidv4() {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
		const r = Math.random() * 16 | 0;
		const v = c === 'x' ? r : (r & 0x3 | 0x8);
		return v.toString(16);
	});
}
