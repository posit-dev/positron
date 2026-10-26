/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * First Claude Code extension release whose `claude-vscode.editor.open`
 * command accepts an initial prompt (2025-11-06). Older releases ignore it.
 */
const MIN_CHAT_VERSION = '2.0.35';

/**
 * Where a new Claude Code conversation opens, or why it can't:
 * - 'chat': the extension's chat panel.
 * - 'terminal': the `claude` command in a terminal.
 * - 'commandNotFound': set to use a terminal, but the command isn't installed.
 * - 'tooOld': the extension is too old to receive a prompt in its chat.
 */
export type ClaudeCodeMode = 'chat' | 'terminal' | 'commandNotFound' | 'tooOld';

/** What decides where a Claude Code conversation opens. */
export interface ClaudeCodeInstallation {
	/** The installed extension's version, e.g. "2.1.303". Undefined without the extension. */
	readonly extensionVersion: string | undefined;
	/** The extension's `claudeCode.useTerminal` setting. */
	readonly useTerminal: boolean;
	/** Whether the `claude` command is installed. Only read for a terminal. */
	readonly hasCommand: boolean;
}

/**
 * Pick where a new conversation opens, following the user's
 * `claudeCode.useTerminal`. Claude Code has no command that takes a prompt and
 * applies the setting itself, so Positron applies it. Without the extension,
 * only the command can be installed, so it's a terminal.
 */
export function getClaudeCodeMode(installation: ClaudeCodeInstallation): ClaudeCodeMode {
	if (installation.extensionVersion === undefined || installation.useTerminal) {
		return installation.hasCommand ? 'terminal' : 'commandNotFound';
	}
	return isAtLeast(installation.extensionVersion, MIN_CHAT_VERSION) ? 'chat' : 'tooOld';
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
