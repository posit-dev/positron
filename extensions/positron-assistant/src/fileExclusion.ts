/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import minimatch from 'minimatch';

/**
 * Checks if a file URI should be excluded from AI features.
 * Uses aiExcludes if explicitly configured, otherwise falls back to inlineCompletionExcludes.
 */
export function isFileExcludedFromAI(uri: vscode.Uri): boolean {
	const config = vscode.workspace.getConfiguration('positron.assistant');

	// Get patterns with fallback to deprecated setting
	let patterns = config.get<string[]>('aiExcludes');
	const inspect = config.inspect<string[]>('aiExcludes');
	if (!inspect?.globalValue && !inspect?.workspaceValue) {
		patterns = config.get<string[]>('inlineCompletionExcludes');
	}

	if (!patterns || patterns.length === 0) {
		return false;
	}

	return patterns.some(pattern => minimatch(uri.path, pattern, { dot: true }));
}
