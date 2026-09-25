/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Payload Positron passes to an error action target's command. Mirrors
 * IErrorActionRequest in Positron core (extensions cannot import it).
 */
export interface ErrorActionRequest {
	action: 'fix' | 'explain';
	prompt: string;
	context: string;
	contextName: string;
}

/**
 * First Claude Code release whose `claude-vscode.terminal.open` command accepts
 * an initial prompt (2025-10-20).
 */
export const MIN_TERMINAL_VERSION = '2.0.24';

/**
 * First Claude Code release whose `claude-vscode.editor.open` command accepts
 * an initial prompt (2025-11-06).
 */
export const MIN_CHAT_VERSION = '2.0.35';

/** A Claude Code command to run, or the minimum version the user must install. */
export type ClaudeCodeLaunch =
	{ kind: 'command'; command: string; args: unknown[] } |
	{ kind: 'outdated'; minimumVersion: string };

/** Build the full prompt, inlining the error context as a fenced block. */
export function formatPrompt(request: ErrorActionRequest): string {
	if (!request.context) {
		return request.prompt;
	}
	// Use a fence longer than any backtick run in the context so the
	// block cannot end early.
	const longestRun = Math.max(0, ...(request.context.match(/`+/g) ?? []).map(run => run.length));
	const fence = '`'.repeat(Math.max(3, longestRun + 1));
	return `${request.prompt}\n\n${request.contextName}:\n${fence}\n${request.context}\n${fence}`;
}

/**
 * Pick the Claude Code command that opens a new session with the prompt.
 * @param version The installed Claude Code version, e.g. "2.1.282".
 * @param useTerminal The user's `claudeCode.useTerminal` setting.
 */
export function getClaudeCodeLaunch(prompt: string, version: string, useTerminal: boolean): ClaudeCodeLaunch {
	if (useTerminal) {
		return isAtLeast(version, MIN_TERMINAL_VERSION)
			? { kind: 'command', command: 'claude-vscode.terminal.open', args: [prompt] }
			: { kind: 'outdated', minimumVersion: MIN_TERMINAL_VERSION };
	}
	// An undefined session ID starts a new conversation with the prompt filled
	// into the input, ready for the user to send.
	return isAtLeast(version, MIN_CHAT_VERSION)
		? { kind: 'command', command: 'claude-vscode.editor.open', args: [undefined, prompt] }
		: { kind: 'outdated', minimumVersion: MIN_CHAT_VERSION };
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
