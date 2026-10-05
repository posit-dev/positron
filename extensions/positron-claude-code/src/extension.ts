/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { canInlineBody, ClaudeCodeSurface, ErrorActionKind, ErrorPrompt, formatFilePrompt, formatInlinePrompt, getClaudeCodeSurface, getErrorPrompt } from './claudeCodeLaunch';

/** Identifier of Anthropic's Claude Code extension. */
const CLAUDE_CODE_EXTENSION_ID = 'anthropic.claude-code';

/**
 * Value of this error action handler in the ai.errorActions.target setting. Matches
 * the Claude Code entry in positron-supervisor's MCP agent table.
 */
const ERROR_ACTIONS_ID = 'claude-code';

/** Directory for error details @-mentioned from prompts. */
const ERROR_DIR = path.join(os.tmpdir(), 'positron-claude-code');

export function activate(context: vscode.ExtensionContext): void {
	// Offer the error action handler only while Claude Code is installed and recent
	// enough to accept a prompt on the surface the user picked.
	let registration: vscode.Disposable | undefined;
	const updateRegistration = () => {
		const available = getSurface() !== undefined;
		if (available && !registration) {
			registration = positron.ai.registerErrorActionHandler(ERROR_ACTIONS_ID, 'Claude Code', {
				fix: context => startSession('fix', context),
				explain: context => startSession('explain', context),
			});
		} else if (!available && registration) {
			registration.dispose();
			registration = undefined;
		}
	};

	updateRegistration();
	context.subscriptions.push(
		vscode.extensions.onDidChange(updateRegistration),
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('claudeCode.useTerminal')) {
				updateRegistration();
			}
		}),
		{ dispose: () => registration?.dispose() }
	);
}

/**
 * Where to open a Claude Code session, honoring `claudeCode.useTerminal`.
 * @returns The surface, or undefined when Claude Code is not installed or too
 *   old to accept a prompt there.
 */
function getSurface(): ClaudeCodeSurface | undefined {
	const claudeCode = vscode.extensions.getExtension(CLAUDE_CODE_EXTENSION_ID);
	if (!claudeCode) {
		return undefined;
	}
	const version: string = claudeCode.packageJSON.version ?? '0.0.0';
	const useTerminal = vscode.workspace.getConfiguration('claudeCode').get<boolean>('useTerminal') === true;
	return getClaudeCodeSurface(version, useTerminal);
}

/** Open a new Claude Code session with the error from a Fix/Explain action. */
async function startSession(kind: ErrorActionKind, context: positron.ai.ErrorActionContext): Promise<void> {
	const prompt = getErrorPrompt(kind, context, uri => vscode.workspace.asRelativePath(uri));

	// The registration is withdrawn when Claude Code becomes unavailable, but
	// an action can still race with that.
	switch (getSurface()) {
		case 'chat':
			return openChat(canInlineBody(prompt) ? formatInlinePrompt(prompt) : await formatPromptWithFile(prompt));
		case 'terminal':
			return openTerminal(await formatPromptWithFile(prompt));
		case undefined:
			throw new Error(vscode.l10n.t('Claude Code is not installed or is too old to receive errors.'));
	}
}

/**
 * Open the chat with the prompt filled into the input. Claude Code has no way
 * to send a prompt programmatically, so the user sends it.
 */
async function openChat(prompt: string): Promise<void> {
	// An undefined session ID starts a new conversation. 'honor-preferred-location'
	// opens the chat where the user keeps it (the sidebar or an editor tab).
	// Without it, Claude Code always opens a tab and switches the user's
	// preferred location to tabs. Older releases ignore the extra arguments.
	await vscode.commands.executeCommand(
		'claude-vscode.editor.open',
		undefined,
		prompt,
		undefined,
		undefined,
		undefined,
		{ programmatic: 'honor-preferred-location' }
	);

	// Focus the input so Enter sends the prompt.
	await vscode.commands.executeCommand('claude-vscode.focus').then(undefined, () => { });
}

/** Start `claude` in a new terminal, which sends the prompt immediately. */
async function openTerminal(prompt: string): Promise<void> {
	await vscode.commands.executeCommand('claude-vscode.terminal.open', prompt);
}

/** Format a single-line prompt, moving its body (if any) to a file it @-mentions. */
async function formatPromptWithFile(prompt: ErrorPrompt): Promise<string> {
	return prompt.body ? formatFilePrompt(prompt, await writeBodyFile(prompt.body)) : prompt.lead;
}

/**
 * Write a prompt body to a temp file for a prompt to @-mention. Left in
 * place so the session can re-read it; the OS clears the temp directory.
 */
async function writeBodyFile(body: string): Promise<string> {
	await fs.mkdir(ERROR_DIR, { recursive: true });
	const bodyPath = path.join(ERROR_DIR, `error-${randomUUID()}.md`);
	await fs.writeFile(bodyPath, body, 'utf8');
	return bodyPath;
}
