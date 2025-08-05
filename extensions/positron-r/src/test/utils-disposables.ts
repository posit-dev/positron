/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { createUniqueId } from './utils';
import { delay } from '../util';

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

	const disposable = toDisposable(async () => await retryRm(realPath));

	return [realPath, disposable];
}

/**
 * Retries async rm for a directory if EBUSY, with delay.
 * Useful for cleanup on Windows where files are locked when in use.
 * There might be a delay between closing an editor and the actual release of
 * the file.
 */
export async function retryRm(dir: string, retries = 30, delayMs = 20) {
	for (let i = 0; i < retries; i++) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
			return;
		} catch (err: any) {
			if (err.code === 'EBUSY' && i < retries - 1) {
				await delay(delayMs);
			} else {
				throw err;
			}
		}
	}
}
