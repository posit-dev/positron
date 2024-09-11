/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Async utilities; some copied from Positron core.

export interface ITask<T> {
	(): T;
}

/**
 * Retry a task until it succeeds or times out.
 *
 * @param task The task to run.
 * @param delay The delay between retries in milliseconds.
 * @param timeout Stop retrying after this number of milliseconds.
 * @returns Promise that resolves with the result of the task, or rejects with the last error.
 */
export async function retryTimeout<T>(task: ITask<Promise<T>>, delay: number, timeout: number): Promise<T> {
	// Track whether the task timed out.
	let timedOut = false;
	const timer = setTimeout(() => timedOut = true, timeout);

	while (true) {
		try {
			// Run the task and clear the timer if it completes.
			const result = await task();
			clearTimeout(timer);
			return result;
		} catch (error) {
			// If we timed out, throw the error.
			if (timedOut) {
				throw error;
			}

			// Otherwise, wait for the delay and try again.
			await new Promise<void>((resolve) => setTimeout(() => resolve(), delay));
		}
	}
}

export function raceTimeout<T>(promise: Promise<T>, timeout: number, onTimeout?: () => void): Promise<T | undefined> {
	let promiseResolve: ((value: T | undefined) => void) | undefined = undefined;

	const timer = setTimeout(() => {
		promiseResolve?.(undefined);
		onTimeout?.();
	}, timeout);

	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise<T | undefined>(resolve => promiseResolve = resolve)
	]);
}
