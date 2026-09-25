/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as positron from 'positron';

/**
 * First Claude Code release whose `claude-vscode.terminal.open` command accepts
 * an initial prompt (2025-10-20).
 */
const MIN_TERMINAL_VERSION = '2.0.24';

/**
 * First Claude Code release whose `claude-vscode.editor.open` command accepts
 * an initial prompt (2025-11-06).
 */
const MIN_CHAT_VERSION = '2.0.35';

/** Where to open the new Claude Code session. */
export type ClaudeCodeSurface = 'chat' | 'terminal';

/** Build the chat prompt, inlining the error as a fenced block. */
export function formatPrompt(context: positron.ai.ErrorActionContext): string {
	if (!context.error) {
		return context.instruction;
	}
	// Use a fence longer than any backtick run in the error so the
	// block cannot end early.
	const longestRun = Math.max(0, ...(context.error.match(/`+/g) ?? []).map(run => run.length));
	const fence = '`'.repeat(Math.max(3, longestRun + 1));
	return `${context.instruction}\n\n${fence}\n${context.error}\n${fence}`;
}

/**
 * Build a single-line terminal prompt that @-mentions a file holding the
 * error. The prompt becomes a `claude` command-line argument, and a newline
 * in it would end the command early.
 * @param errorPath File containing `context.error`, or undefined when there
 *   is no error output.
 */
export function formatTerminalPrompt(context: positron.ai.ErrorActionContext, errorPath: string | undefined): string {
	const prompt = context.instruction.replace(/\s*\n\s*/g, ' ');
	if (!errorPath) {
		return prompt;
	}
	const mention = /\s/.test(errorPath) ? `@"${errorPath}"` : `@${errorPath}`;
	return `${prompt} ${mention}`;
}

/**
 * Pick where to open the new session, honoring `claudeCode.useTerminal`.
 * @param version The installed Claude Code version, e.g. "2.1.282".
 * @returns The surface, or undefined when the installed version is too old
 *   to accept a prompt there.
 */
export function getClaudeCodeSurface(version: string, useTerminal: boolean): ClaudeCodeSurface | undefined {
	const minimumVersion = useTerminal ? MIN_TERMINAL_VERSION : MIN_CHAT_VERSION;
	if (!isAtLeast(version, minimumVersion)) {
		return undefined;
	}
	return useTerminal ? 'terminal' : 'chat';
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
