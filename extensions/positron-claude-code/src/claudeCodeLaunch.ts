/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as positron from 'positron';
import type { Uri } from 'vscode';

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

/** An error action the user can take. */
export type ErrorActionKind = 'fix' | 'explain';

/**
 * Longest prompt body inlined into the chat input. Longer bodies (e.g. a
 * pasted script that failed in the console) go in a file the prompt points to.
 */
const MAX_INLINE_BODY_LENGTH = 8000;

/** A prompt for an error, split so the body can move to a file. */
export interface ErrorPrompt {
	/** A single line saying where the error came from and what to do about it. */
	readonly lead: string;
	/** Fenced code and error blocks; empty when there is no error output. */
	readonly body: string;
}

/**
 * Build the prompt for a Fix or Explain action. Prompts are in English: they
 * are read by the agent, not the user.
 * @param getPath Resolves a document URI to the path named in the prompt.
 */
export function getErrorPrompt(
	kind: ErrorActionKind,
	context: positron.ai.ErrorActionContext,
	getPath: (uri: Uri) => string,
): ErrorPrompt {
	const location = context.location;
	const task = kind === 'fix'
		? 'Fix the error.'
		: 'Explain what caused the error and how to fix it, without making changes or editing any files.';
	const blocks: string[] = [];
	let source: string | undefined;
	switch (location?.kind) {
		case 'console':
			// Without this, Claude has nothing to open and guesses at a file
			// (e.g. a notebook) the error might have come from.
			source = `Code run in the Positron console session "${location.sessionName}" raised an error. ` +
				'The code may not be saved in any file.';
			if (location.code) {
				blocks.push(`Code:\n\n${fence(location.code, location.languageId)}`);
			}
			break;
		case 'notebook':
			source = location.cellIndex === undefined
				? `A cell in ${getPath(location.uri)} raised an error.`
				: `Cell ${location.cellIndex + 1} of ${getPath(location.uri)} raised an error.`;
			break;
		case 'quarto':
			source = `The ${location.languageId} code chunk at lines ${location.startLine}-${location.endLine} ` +
				`of ${getPath(location.uri)} raised an error.`;
			break;
	}
	if (context.error) {
		blocks.push(`Error:\n\n${fence(context.error)}`);
	}
	// The console's code is not in the project, so a fix there usually means
	// corrected code to run rather than an edit.
	const scope = kind === 'fix' && location?.kind === 'console'
		? ' Only edit project files if the cause is in one of them.'
		: '';
	const lead = source ? `${source} ${task}${scope}` : task;
	// Newlines would end a terminal prompt early (e.g. one in a session name).
	return { lead: lead.replace(/\s*\n\s*/g, ' '), body: blocks.join('\n\n') };
}

/** Whether a prompt's body is short enough to inline into the chat input. */
export function canInlineBody(prompt: ErrorPrompt): boolean {
	return prompt.body.length <= MAX_INLINE_BODY_LENGTH;
}

/** Format a prompt with its body inline. */
export function formatInlinePrompt(prompt: ErrorPrompt): string {
	return prompt.body ? `${prompt.lead}\n\n${prompt.body}` : prompt.lead;
}

/**
 * Format a single-line prompt that @-mentions a file holding the body. A
 * terminal prompt becomes a `claude` command-line argument, and a newline in
 * it would end the command early.
 * @param bodyPath File containing `prompt.body`.
 */
export function formatFilePrompt(prompt: ErrorPrompt, bodyPath: string): string {
	const mention = /\s/.test(bodyPath) ? `@"${bodyPath}"` : `@${bodyPath}`;
	return `${prompt.lead} The details are in ${mention}`;
}

/**
 * Fence a block, using a fence longer than any backtick run in the text so
 * the block cannot end early.
 */
function fence(text: string, languageId = ''): string {
	const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length));
	const marker = '`'.repeat(Math.max(3, longestRun + 1));
	return `${marker}${languageId}\n${text}\n${marker}`;
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
