/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { RSession } from '../session';
import { delay } from '../util';

export function mock<T>(obj: Partial<T>): T {
	return obj as T;
}

export function createUniqueId(): string {
	return Math.floor(Math.random() * 0x100000000).toString(16);
}

export async function startR(): Promise<[RSession, vscode.Disposable]> {
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

	const session = await positron.runtime.startLanguageRuntime(info!.runtimeId, 'Tests') as RSession;

	const disposable = toDisposable(async () => {
		await session.shutdown();
		await session.dispose();
	});

	return [session, disposable];
}

/**
 * Executes R code using `positron.runtime.executeCode`.
 * Doesn't take focus and incomplete statements are not allowed.
 * @param src The R code to execute.
 */
export async function execute(src: string) {
	await positron.runtime.executeCode('r', src, false, false);
}

/**
 * Create a unique temporary directory and return its path along with a disposable that deletes it.
 * The directory name includes the provided component and a unique suffix.
 */
export function makeTempDir(component: string): [string, vscode.Disposable] {
	const uniqueId = createUniqueId();
	const dir = path.join(os.tmpdir(), `${component}-${uniqueId}`);
	fs.mkdirSync(dir, { recursive: true });

	// Use `realpathSync()` to match `normalizePath()` treatment on the R side.
	// Otherwise our `/vars/...` tempfile becomes `/private/vars/...` and it
	// might not look like the same file is being opened.
	const realPath = fs.realpathSync(dir);

	const disposable = toDisposable(() => {
		// Recursively remove the directory and its contents
		fs.rmSync(realPath, { recursive: true, force: true });
	});

	return [realPath, disposable];
}

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
 * Utility to wrap a cleanup function as a vscode.Disposable.
 */
export function toDisposable(fn: () => void | Promise<void>): vscode.Disposable {
	return {
		dispose: fn
	};
}

/**
 * Disposes all disposables in the array in LIFO order, awaiting any promises returned.
 */
export async function disposeAll(disposables: vscode.Disposable[]) {
	// Await in reverse order
	for (let i = disposables.length - 1; i >= 0; i--) {
		await disposables[i].dispose();
	}
}

/**
 * Runs a closure with a disposables array, ensuring all disposables are disposed in reverse order after execution.
 * @param fn The closure to run, which receives the disposables array.
 */
export async function withDisposables<T>(
	fn: (disposables: vscode.Disposable[]) => Promise<T> | T
): Promise<T> {
	const disposables: vscode.Disposable[] = [];
	try {
		return await fn(disposables);
	} finally {
		await disposeAll(disposables);
	}
}

/**
 * Asserts that the currently active text editor matches the given URI and its
 * contents match the provided regex string. Retries until success or timeout.
 */
export async function assertSelectedEditor(uri: vscode.Uri, text: string) {
	// Poll for success because we can't synchronise `navigateToFile` reliably
	await pollForSuccess(() => {
		const ed = vscode.window.activeTextEditor;

		if (ed === undefined || ed.document.uri.fsPath !== uri.fsPath) {
			assert.fail(`Expected active editor for ${uri.fsPath}, but got ${ed?.document.uri.fsPath ?? 'undefined'}`);
		}

		assert.match(
			ed.document.getText(),
			new RegExp(text),
			`Unexpected editor contents for ${uri.fsPath}`
		);
	});
}
