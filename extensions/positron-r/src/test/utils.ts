/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export function mock<T>(obj: Partial<T>): T {
	return obj as T;
}

export function createUniqueId(): string {
	return Math.floor(Math.random() * 0x100000000).toString(16);
}

import * as assert from 'assert';

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
