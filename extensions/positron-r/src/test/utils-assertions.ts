/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { delay } from '../util';

/**
 * Waits for the given predicate to succeed (not throw an assertion error) within the timeout.
 * Retries on assertion errors, throws immediately on other errors.
 * @param predicate Function that should throw an assertion error if the condition is not met.
 * @param intervalMs Polling interval in milliseconds.
 * @param timeoutMs Timeout in milliseconds.
 * @param message Message for assertion error on timeout.
 */
export async function pollForSuccess(
	predicate: () => void | Promise<void>,
	intervalMs = 10,
	timeoutMs = 5000,
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

/**
 * Asserts that the currently active text editor matches the given URI and its
 * contents match the provided regex string. Retries until success or timeout.
 */
export async function assertSelectedEditor(uri: vscode.Uri, text: string) {
	// Poll for success because we can't synchronise `navigateToFile` reliably
	await pollForSuccess(() => {
		const ed = vscode.window.activeTextEditor;

		const expectedPath = fs.realpathSync.native(path.normalize(uri.fsPath)).toLowerCase();
		const actualPath = ed ? fs.realpathSync.native(path.normalize(ed.document.uri.fsPath)).toLowerCase() : undefined;

		if (ed === undefined || actualPath !== expectedPath) {
			assert.fail(`Expected active editor for ${expectedPath}, but got ${actualPath ?? 'undefined'}`);
		}

		assert.match(
			ed.document.getText(),
			new RegExp(text),
			`Unexpected editor contents for ${uri.fsPath}:\n${ed.document.getText()}\n\nExpected:\n${text}`
		);
	});
}
