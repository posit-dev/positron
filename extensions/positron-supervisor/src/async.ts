/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * PromiseHandles is a class that represents a promise that can be resolved or
 * rejected externally.
 */
export class PromiseHandles<T> {
	resolve!: (value: T | Promise<T>) => void;

	reject!: (error: unknown) => void;

	promise: Promise<T>;

	constructor() {
		this.promise = new Promise((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
		});
	}
}

/**
 * A barrier that is initially closed and then becomes opened permanently.
 * Ported from VS Code's async.ts.
 */

export class Barrier {
	private _isOpen: boolean;
	private _promise: Promise<boolean>;
	private _completePromise!: (v: boolean) => void;

	constructor() {
		this._isOpen = false;
		this._promise = new Promise<boolean>((c, _e) => {
			this._completePromise = c;
		});
	}

	isOpen(): boolean {
		return this._isOpen;
	}

	open(): void {
		this._isOpen = true;
		this._completePromise(true);
	}

	wait(): Promise<boolean> {
		return this._promise;
	}
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
 * Creates a short, unique ID. Use to help create unique identifiers for
 * comms, messages, etc.
 *
 * @returns An 8-character unique ID, like `a1b2c3d4`
 */
export function createUniqueId(): string {
	return Math.floor(Math.random() * 0x100000000).toString(16);
}
