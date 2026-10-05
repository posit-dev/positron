/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as positron from 'positron';
import type { Uri } from 'vscode';

/** An error action the user can take. */
export type ErrorActionKind = 'fix' | 'explain';

/**
 * Longest prompt body inlined into a prompt. Longer bodies (e.g. a pasted
 * script that failed in the console) go in a file the prompt points to.
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
 * Build the prompt for a Fix or Explain action, for any coding agent. Prompts
 * are in English: they are read by the agent, not the user.
 * @param getPath Resolves a document URI to the path named in the prompt.
 * @param mcpServerName The name the agent knows Positron's MCP server by,
 *   or undefined when it is not configured.
 */
export function getErrorPrompt(
	kind: ErrorActionKind,
	context: positron.ai.ErrorActionContext,
	getPath: (uri: Uri) => string,
	mcpServerName?: string,
): ErrorPrompt {
	const location = context.location;
	const task = kind === 'fix'
		? 'Fix the error.'
		: 'Explain what caused the error and how to fix it, without making changes or editing any files.';
	const blocks: string[] = [];
	let source: string | undefined;
	let mcpHint = '';
	switch (location?.kind) {
		case 'console':
			// Without this, the agent has nothing to open and guesses at a file
			// (e.g. a notebook) the error might have come from.
			source = `Code run in the Positron console session "${location.sessionName}" raised an error. ` +
				'The code may not be saved in any file.';
			if (mcpServerName) {
				mcpHint = ' ' + getMcpHint(mcpServerName, location.sessionId, 'this session');
			}
			if (location.code) {
				blocks.push(`Code:\n\n${fence(location.code, location.languageId)}`);
			}
			break;
		case 'notebook':
			source = location.cellIndex === undefined
				? `A cell in ${getPath(location.uri)} raised an error.`
				: `Cell ${location.cellIndex + 1} of ${getPath(location.uri)} raised an error.`;
			if (mcpServerName && location.sessionId) {
				mcpHint = ' ' + getMcpHint(mcpServerName, location.sessionId, 'the notebook\'s kernel session') +
					' ' + INSPECT_ONLY;
			}
			break;
		case 'quarto':
			source = `The ${location.languageId} code chunk at lines ${location.startLine}-${location.endLine} ` +
				`of ${getPath(location.uri)} raised an error.`;
			if (mcpServerName && location.sessionId) {
				mcpHint = ' ' + getMcpHint(mcpServerName, location.sessionId, 'the document\'s kernel session') +
					' ' + INSPECT_ONLY;
			}
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
	const lead = source ? `${source} ${task}${scope}${mcpHint}` : task;
	// Newlines would end a terminal prompt early (e.g. one in a session name).
	return { lead: lead.replace(/\s*\n\s*/g, ' '), body: blocks.join('\n\n') };
}

/**
 * Keeps the agent from running code in a notebook or Quarto kernel, which would
 * change the state the user's cells depend on.
 */
const INSPECT_ONLY = 'Use it to inspect the kernel\'s state, not to run code that changes it.';

/**
 * Point the agent at Positron's MCP server for a session. A new agent session
 * may send its first request before the server connects, and an agent that
 * finds no tools concludes it has no access.
 */
function getMcpHint(serverName: string, sessionId: string, sessionDescription: string): string {
	return `Positron's MCP server (\`${serverName}\`) can inspect ${sessionDescription} (session_id: ${sessionId}). ` +
		'Its tools may take a moment to connect; don\'t conclude you lack access.';
}

/** Whether a prompt's body is short enough to inline. */
export function canInlineBody(prompt: ErrorPrompt): boolean {
	return prompt.body.length <= MAX_INLINE_BODY_LENGTH;
}

/** Format a prompt with its body inline. */
export function formatInlinePrompt(prompt: ErrorPrompt): string {
	return prompt.body ? `${prompt.lead}\n\n${prompt.body}` : prompt.lead;
}

/**
 * Format a single-line prompt that @-mentions a file holding the body, for
 * surfaces that cannot take a multi-line prompt or a long one.
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
