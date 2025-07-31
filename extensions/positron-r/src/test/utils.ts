/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { RSession } from '../session';

export function mock<T>(obj: Partial<T>): T {
	return obj as T;
}

export function createUniqueId(): string {
	return Math.floor(Math.random() * 0x100000000).toString(16);
}

import * as assert from 'assert';

export async function startR(): Promise<RSession> {
	// There doesn't seem to be a method that resolves when a language is
	// both discovered and ready to be started
	let info;

	const startTime = Date.now();
	const timeout = 30000;

	while (true) {
		try {
			info = await positron.runtime.getPreferredRuntime('r');
			if (info) {
				break;
			}
		} catch (_) {
			if (Date.now() - startTime > timeout) {
				throw new Error('Timeout while waiting for preferred R runtime');
			}
			await delay(50);
		}
	}

	return await positron.runtime.startLanguageRuntime(info!.runtimeId, 'Tests') as RSession;
}

/**
 * Starts an R session, runs the given closure, and ensures shutdown on exit.
 * @param fn The closure to run with the started RSession.
 */
export async function withRSession<T>(
	fn: (session: RSession) => Promise<T> | T
): Promise<T> {
	const session = await startR();
	try {
		return await fn(session);
	} finally {
		await session.shutdown();
		await session.dispose();
	}
}

/**
 * Waits until the predicate returns a non-undefined value or times out.
 * Throws an assertion error if the timeout is reached.
 * @param predicate Async function returning a value when the condition is met, or undefined otherwise.
 * @param intervalMs Polling interval in milliseconds.
 * @param timeoutMs Maximum time to wait in milliseconds.
 * @param message Optional message for assertion error on timeout.
 * @returns The first non-undefined value returned by predicate.
 */
export async function waitFor<T>(
	predicate: () => T | undefined | Promise<T | undefined>,
	intervalMs = 10,
	timeoutMs = 5000,
	message = 'waitFor: condition not met within timeout'
): Promise<T> {
	const start = Date.now();
	while (Date.now() - start <= timeoutMs) {
		const result = await predicate();
		if (result !== undefined && result !== null) {
			return result;
		}
		await delay(intervalMs);
	}

	assert.fail(message);
}

// Import delay from util
import { delay } from '../util';
