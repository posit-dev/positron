/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * First Claude Code extension release whose `claude-vscode.editor.open`
 * command accepts an initial prompt (2025-11-06). Older releases ignore it.
 */
const MIN_CHAT_VERSION = '2.0.35';

/** Whether a Claude Code extension version can receive a prompt in its chat. */
export function chatTakesPrompt(version: string): boolean {
	return isAtLeast(version, MIN_CHAT_VERSION);
}

/** Compare dotted numeric versions, ignoring any prerelease suffix. */
function isAtLeast(version: string, minimum: string): boolean {
	const parse = (v: string) => v.split('-')[0].split('.').map(part => parseInt(part, 10) || 0);
	const actual = parse(version);
	const required = parse(minimum);
	for (let i = 0; i < Math.max(actual.length, required.length); i++) {
		const difference = (actual[i] ?? 0) - (required[i] ?? 0);
		if (difference !== 0) {
			return difference > 0;
		}
	}
	return true;
}
