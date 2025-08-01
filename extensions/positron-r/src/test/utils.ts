/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as assert from 'assert';
import { RSession } from '../session';
import { delay } from '../util';

export function mock<T>(obj: Partial<T>): T {
	return obj as T;
}

export function createUniqueId(): string {
	return Math.floor(Math.random() * 0x100000000).toString(16);
}

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
			// Try again
		}

		if (Date.now() - startTime > timeout) {
			throw new Error('Timeout while waiting for preferred R runtime');
		}
		await delay(50);
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
 * Waits for the given predicate to succeed (not throw an assertion error) within the timeout.
 * Retries on assertion errors, throws immediately on other errors.
 * @param predicate Function that should throw an assertion error if the condition is not met.
 * @param intervalMs Polling interval in milliseconds.
 * @param timeoutMs Timeout in milliseconds.
 * @param message Message for assertion error on timeout.
 */
export async function waitForSuccess(
	predicate: () => void | Promise<void>,
	intervalMs = 10,
	timeoutMs = 5000,
	message = 'waitFor: condition not met within timeout'
): Promise<void> {
	const start = Date.now();

	while (Date.now() - start <= timeoutMs) {
		try {
			return await predicate();
		} catch (err) {
			if (err instanceof assert.AssertionError) {
				// Try again
			} else {
				throw err;
			}
		}

		await delay(intervalMs);
	}

	// Run one last time, letting any assertion errors escape
	return await predicate();
}
