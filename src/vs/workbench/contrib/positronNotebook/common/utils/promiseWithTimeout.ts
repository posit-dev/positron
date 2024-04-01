/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';

/**
 * Function to wrap a promise in a timeout. Also allows for the unsubscribing to the promise output.
 * @param promise Promise to wrap.
 * @param timeoutMs Timeout in milliseconds.
 * @param cancelToken Token to cancel the promise as returned by `CancellationTokenSource.token`.
 */
export function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number, cancelToken: CancellationToken): Promise<T> {

	return new Promise((resolve, reject) => {
		cancelToken.onCancellationRequested(() => {
			reject(new Error('Promise cancelled'));
		});

		const timeout = setTimeout(() => {
			reject(new Error('Promise timed out'));
		}, timeoutMs);

		promise.then((res) => {
			clearTimeout(timeout);
			resolve(res);
		}).catch((err) => {
			clearTimeout(timeout);
			reject(err);
		});
	});
}
