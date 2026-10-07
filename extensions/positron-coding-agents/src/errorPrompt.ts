/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as positron from 'positron';
import type { Uri } from 'vscode';

/** An error action the user can take. */
export type ErrorActionKind = 'fix' | 'explain';

/**
 * Longest code and error text, together, in a prompt. Prompts are passed on
 * the command line, which Windows caps at 32,767 characters, so longer text
 * (e.g. a pasted script that failed in the console) is cut in the middle.
 */
const MAX_DETAILS_LENGTH = 30_000;

/** Code kept when an error alone would fill the prompt. */
const MIN_CODE_LENGTH = 2_000;

/**
 * How a notebook's or Quarto document's contents differ from its file, so the
 * agent cannot read the failing code from it: never saved, or saved with
 * changes since.
 */
export type UnsavedState = 'untitled' | 'dirty';

/**
 * Build the prompt for a Fix or Explain action, for any coding agent. Prompts
 * are in English: they are read by the agent, not the user.
 * @param getPath Resolves a document URI to the path named in the prompt.
 * @param mcpServerName The name the agent knows Positron's MCP server by,
 *   or undefined when it is not configured.
 * @param unsavedState How the failing notebook cell's or Quarto chunk's
 *   document differs from its file, or undefined when it is saved. Its code
 *   is included only when it isn't.
 */
export function getErrorPrompt(
	kind: ErrorActionKind,
	context: Omit<positron.ai.ErrorActionContext, 'chat'>,
	getPath: (uri: Uri) => string,
	mcpServerName?: string,
	unsavedState?: UnsavedState,
): string {
	const location = context.location;
	const fullCode = location?.kind === 'console' || unsavedState ? location?.code : undefined;
	// The code is cut before the error, since the agent can more likely find
	// the code elsewhere (e.g. the console's history) than the error.
	const code = fullCode
		? truncateMiddle(fullCode, Math.max(MIN_CODE_LENGTH, MAX_DETAILS_LENGTH - context.error.length))
		: undefined;
	const error = truncateMiddle(context.error, MAX_DETAILS_LENGTH - (code?.length ?? 0));
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
			break;
		case 'notebook':
			source = location.cellIndex === undefined
				? `A cell in ${getPath(location.uri)} raised an error.`
				: `Cell ${location.cellIndex + 1} of ${getPath(location.uri)} raised an error.`;
			if (unsavedState && location.code) {
				source += unsavedState === 'untitled'
					? ' The notebook is not saved to a file, so the cell\'s code is below.'
					: ' The notebook has unsaved changes, so the cell\'s code is below.';
			}
			if (mcpServerName && location.sessionId) {
				mcpHint = ' ' + getMcpHint(mcpServerName, location.sessionId, 'the notebook\'s kernel session') +
					' ' + INSPECT_ONLY;
			}
			break;
		case 'quarto':
			source = `The ${location.languageId} code chunk at lines ${location.startLine}-${location.endLine} ` +
				`of ${getPath(location.uri)} raised an error.`;
			if (unsavedState) {
				source += unsavedState === 'untitled'
					? ' The document is not saved to a file, so the chunk\'s code is below.'
					: ' The document has unsaved changes, so the chunk\'s code is below.';
			}
			if (mcpServerName && location.sessionId) {
				mcpHint = ' ' + getMcpHint(mcpServerName, location.sessionId, 'the document\'s kernel session') +
					' ' + INSPECT_ONLY;
			}
			break;
	}
	if (code) {
		blocks.push(`Code:\n\n${fence(code, location?.languageId)}`);
	}
	if (error) {
		blocks.push(`Error:\n\n${fence(error)}`);
	}
	// The console's code is not in the project, so a fix there usually means
	// corrected code to run rather than an edit.
	const scope = kind === 'fix' && location?.kind === 'console'
		? ' Only edit project files if the cause is in one of them.'
		: '';
	const lead = source ? `${source} ${task}${scope}${mcpHint}` : task;
	return [lead, ...blocks].join('\n\n');
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

/** Cut text longer than `maxLength` in the middle, keeping its start and end. */
function truncateMiddle(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}
	const head = Math.floor(maxLength / 2);
	const tail = maxLength - head;
	return `${text.slice(0, head)}\n[... ${text.length - maxLength} characters omitted ...]\n${text.slice(text.length - tail)}`;
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
