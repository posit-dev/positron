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
	conversation: 'new' | 'current';
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
	return `${request.prompt}\n\n${fence}\n${request.context}\n${fence}`;
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
	return `${prompt} ${mention}`;
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

/**
 * First Claude Code release whose `claude-vscode.terminal.open` command accepts
 * CLI arguments such as `--continue` (2025-11-15). Older releases ignore them.
 */
export const MIN_TERMINAL_ARGS_VERSION = '2.0.42';

/** Whether the installed Claude Code passes CLI arguments to a terminal session. */
export function supportsTerminalArgs(version: string): boolean {
	return isAtLeast(version, MIN_TERMINAL_ARGS_VERSION);
}

/** Longest project directory name Claude Code stores without hashing. */
const MAX_PROJECT_DIR_NAME = 200;

/**
 * Name of the directory under `~/.claude/projects` where Claude Code keeps a
 * workspace's session transcripts, mirroring Claude Code's own naming.
 * @returns The name, or undefined for long paths Claude Code hashes.
 */
export function getProjectDirName(workspacePath: string): string | undefined {
	const name = workspacePath.replace(/[^a-zA-Z0-9]/g, '-');
	return name.length <= MAX_PROJECT_DIR_NAME ? name : undefined;
}

/** A session transcript file in a Claude Code project directory. */
export interface SessionFile {
	name: string;
	mtimeMs: number;
}

/**
 * Pick the most recently active session, the one `claude --continue` resumes.
 * @returns The session ID, or undefined when there are no sessions.
 */
export function getLatestSessionId(files: SessionFile[]): string | undefined {
	const sessionFile = /^(?<id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;
	let latest: { id: string; mtimeMs: number } | undefined;
	for (const file of files) {
		const id = sessionFile.exec(file.name)?.groups?.id;
		if (id && (!latest || file.mtimeMs > latest.mtimeMs)) {
			latest = { id, mtimeMs: file.mtimeMs };
		}
	}
	return latest?.id;
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
