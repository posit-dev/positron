/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* Utilities copied from ../../../src/vs/base/common/async.ts */

export function raceTimeout<T>(promise: Promise<T>, timeout: number, onTimeout?: () => void): Promise<T | undefined> {
	let promiseResolve: ((value: T | undefined) => void) | undefined = undefined;
	let promiseReject: ((reason?: unknown) => void) | undefined = undefined;

	const timer = setTimeout(() => {
		try {
			onTimeout?.();
			promiseResolve?.(undefined);
		} catch (error) {
			promiseReject?.(error);
		}
	}, timeout);

	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise<T | undefined>((resolve, reject) => {
			promiseResolve = resolve;
			promiseReject = reject;
		})
	]);
}

export interface ITask<T> {
	(): T;
}

export class SequencerByKey<TKey> {

	private promiseMap = new Map<TKey, Promise<unknown>>();

	has(key: TKey): boolean {
		return this.promiseMap.has(key);
	}

	queue<T>(key: TKey, promiseTask: ITask<Promise<T>>): Promise<T> {
		const runningPromise = this.promiseMap.get(key) ?? Promise.resolve();
		const newPromise = runningPromise
			// Swallow unhandled errors from the previous task so the current one still runs.
			.catch((error) => { console.warn(`[positron-run-app] Previous queued task for key '${key}' failed:`, error); })
			.then(promiseTask)
			.finally(() => {
				if (this.promiseMap.get(key) === newPromise) {
					this.promiseMap.delete(key);
				}
			});
		this.promiseMap.set(key, newPromise);
		return newPromise;
	}
}

/* Utilities copied from ../../../src/vs/base/common/strings.ts */

const CSI_SEQUENCE = /(?:(?:\x1b\[|\x9B)[=?>!]?[\d;:]*["$#'* ]?[a-zA-Z@^`{}|~])|(:?\x1b\].*?\x07)/g;

export function removeAnsiEscapeCodes(str: string): string {
	if (str) {
		str = str.replace(CSI_SEQUENCE, '');
	}

	return str;
}
