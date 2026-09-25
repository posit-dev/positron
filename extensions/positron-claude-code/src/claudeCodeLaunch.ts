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

/** Where to open the new Claude Code session, or the minimum version needed. */
export type ClaudeCodeSurface =
	{ kind: 'chat' } |
	{ kind: 'terminal' } |
	{ kind: 'outdated'; minimumVersion: string };

/** Build the chat prompt, inlining the error context as a fenced block. */
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
 * Build a single-line terminal prompt that @-mentions a file holding the
 * error context. The prompt becomes a `claude` command-line argument, and a
 * newline in it would end the command early.
 * @param contextPath File containing `request.context`, or undefined when
 *   there is no context.
 */
export function formatTerminalPrompt(request: ErrorActionRequest, contextPath: string | undefined): string {
	const prompt = request.prompt.replace(/\s*\n\s*/g, ' ');
	if (!contextPath) {
		return prompt;
	}
	const mention = /\s/.test(contextPath) ? `@"${contextPath}"` : `@${contextPath}`;
	return `${prompt} ${request.contextName}: ${mention}`;
}

/**
 * Pick where to open the new session, honoring `claudeCode.useTerminal`.
 * @param version The installed Claude Code version, e.g. "2.1.282".
 */
export function getClaudeCodeSurface(version: string, useTerminal: boolean): ClaudeCodeSurface {
	const minimumVersion = useTerminal ? MIN_TERMINAL_VERSION : MIN_CHAT_VERSION;
	if (!isAtLeast(version, minimumVersion)) {
		return { kind: 'outdated', minimumVersion };
	}
	return { kind: useTerminal ? 'terminal' : 'chat' };
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
