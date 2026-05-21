/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import minimatch from 'minimatch';
import * as path from 'path';

/**
 * Checks if a file URI should be excluded from AI features.
 * Uses aiExcludes; only falls back to the deprecated inlineCompletionExcludes when the user
 * explicitly set it (migration aid). Otherwise the contributed aiExcludes default applies.
 * For patterns without '/', matches against basename only for intuitive behavior.
 */
export function isFileExcludedFromAI(uri: vscode.Uri): boolean {
	const config = vscode.workspace.getConfiguration('positron.assistant');

	// `inspect()` reports user-written values in `globalValue` / `workspaceValue`;
	// the contributed default lives in a separate `defaultValue` field. Checking
	// `!== undefined` (not truthy) is deliberate: an empty array is still a user
	// value and means "user said exclude nothing," which must not be overridden.
	const aiInspect = config.inspect<string[]>('aiExcludes');
	const inlineInspect = config.inspect<string[]>('inlineCompletionExcludes');
	const aiSetByUser = aiInspect?.globalValue !== undefined || aiInspect?.workspaceValue !== undefined;
	const inlineSetByUser = inlineInspect?.globalValue !== undefined || inlineInspect?.workspaceValue !== undefined;

	// Honor the deprecated `inlineCompletionExcludes` only as a migration aid:
	// the user explicitly set it and hasn't moved to `aiExcludes` yet. Stock
	// users fall through to the `aiExcludes` contributed default via `.get()`.
	const patterns = (!aiSetByUser && inlineSetByUser)
		? config.get<string[]>('inlineCompletionExcludes')
		: config.get<string[]>('aiExcludes');

	if (!patterns || patterns.length === 0) {
		return false;
	}

	return patterns.some(pattern => {
		if (!pattern.includes('/')) {
			return minimatch(path.basename(uri.path), pattern, { dot: true });
		}
		return minimatch(uri.path, pattern, { dot: true });
	});
}
