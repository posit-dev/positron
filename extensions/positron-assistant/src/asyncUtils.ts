/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';

/**
 * Returns true when `t` looks like a `vscode.CancellationToken` -- i.e. has
 * a function-typed `onCancellationRequested` and a boolean-typed
 * `isCancellationRequested`. Used to guard cross-boundary command args
 * where serialization may strip method members or where untrusted callers
 * may pass arbitrary shapes.
 *
 * Property reads are wrapped so an object with a throwing getter on either
 * field returns `false` rather than propagating the throw -- the whole
 * point of this helper is to make malformed inputs fail safely.
 */
export function isCancellationTokenLike(t: unknown): t is vscode.CancellationToken {
	if (!t || typeof t !== 'object') { return false; }
	try {
		const candidate = t as Partial<vscode.CancellationToken>;
		return typeof candidate.onCancellationRequested === 'function'
			&& typeof candidate.isCancellationRequested === 'boolean';
	} catch {
		return false;
	}
}

/**
 * Race a promise against a timeout. Returns the promise result, or
 * `undefined` if the timeout fires first. The timer is cleaned up
 * internally. An optional `onTimeout` callback runs when the timeout fires.
 *
 * If the timeout wins and the input promise rejects later, the rejection is
 * silently swallowed (so it does not surface as an unhandled rejection). If
 * the input promise wins the race, the caller still observes its rejection
 * normally.
 */
export async function raceTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	onTimeout?: () => void,
): Promise<T | undefined> {
	// Attach a no-op handler so a late rejection (after the timeout has
	// already won) does not become an unhandled rejection. The original
	// promise's settlement is still observed by Promise.race below.
	promise.catch(() => { });
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<undefined>(resolve => {
				timer = setTimeout(() => {
					onTimeout?.();
					resolve(undefined);
				}, timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
