/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function mock<T>(obj: Partial<T>): T {
	return obj as T;
}

export function createUniqueId(): string {
	return Math.floor(Math.random() * 0x100000000).toString(16);
}

/**
 * Normalize a file path for robust comparison (realpath, normalize, lower-case).
 */
export function normalizePath(p: string): string {
	const normalized = path.normalize(p);

	// `realPathSync` takes care of expanding e.g. `runner~1` to `runneradmin`.
	// Can only use it if the path actually exists.
	const real = fs.existsSync(normalized) ? fs.realpathSync.native(normalized) : normalized;

	// On Windows, paths are not case sensitive and we might get mixups. On mac it
	// depends but let's only lowercase if we find it's needed.
	return process.platform === 'win32' ? real.toLowerCase() : real;
}

/**
 * Normalize a vscode.Uri for robust comparison.
 * For file URIs, uses `normalizePath()`; otherwise, uses `uri.toString()`.
 */
export function normalizeUri(uri: vscode.Uri): string {
	return uri.scheme === 'file'
		? normalizePath(uri.fsPath)
		: uri.toString();
}
