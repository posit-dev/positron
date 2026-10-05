/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'node:child_process';
import * as os from 'node:os';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { CodingAgent, formatPromptWithFile } from './codingAgent';
import { hasForegroundProcess, isClaudeCodeCommand, parseProcessTable, ProcessInfo, PS_ARGS } from './foregroundProcess';
import { ClaudeCodeSurface, getClaudeCodeSurface } from './claudeCodeSurface';
import { canInlineBody, ErrorPrompt, formatInlinePrompt } from './errorPrompt';

/** Identifier of Anthropic's Claude Code extension. */
const CLAUDE_CODE_EXTENSION_ID = 'anthropic.claude-code';

/** Claude Code, through its VS Code extension's chat or terminal. */
export const claudeCode: CodingAgent = {
	id: 'claude-code',
	label: 'Claude Code',
	isAvailable: () => getSurface() !== undefined,
	start,
};

/**
 * Where to open a Claude Code session, honoring `claudeCode.useTerminal`.
 * @returns The surface, or undefined when Claude Code is not installed or too
 *   old to accept a prompt there.
 */
function getSurface(): ClaudeCodeSurface | undefined {
	const extension = vscode.extensions.getExtension(CLAUDE_CODE_EXTENSION_ID);
	if (!extension) {
		return undefined;
	}
	const version: string = extension.packageJSON.version ?? '0.0.0';
	const useTerminal = vscode.workspace.getConfiguration('claudeCode').get<boolean>('useTerminal') === true;
	return getClaudeCodeSurface(version, useTerminal);
}

/**
 * Send the prompt to a Claude Code session already running in a terminal, or
 * open a new one.
 */
async function start(prompt: ErrorPrompt): Promise<void> {
	const terminal = await findClaudeCodeTerminal();
	if (terminal) {
		return pasteIntoTerminal(terminal, canInlineBody(prompt) ? formatInlinePrompt(prompt) : await formatPromptWithFile(prompt));
	}

	// The registration is withdrawn when Claude Code becomes unavailable, but
	// an action can still race with that.
	switch (getSurface()) {
		case 'chat':
			return openChat(canInlineBody(prompt) ? formatInlinePrompt(prompt) : await formatPromptWithFile(prompt));
		case 'terminal':
			// Multi-line prompts to terminal.open are cut at the first newline
			// and the rest leaks into the terminal as keystrokes.
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

/**
 * Find a terminal whose foreground job is Claude Code, preferring the active
 * terminal, then the most recently created.
 * @returns The terminal, or undefined when there is none or the process table
 *   cannot be read (e.g. on Windows, which has no `ps`).
 */
async function findClaudeCodeTerminal(): Promise<vscode.Terminal | undefined> {
	if (os.platform() === 'win32' || vscode.window.terminals.length === 0) {
		return undefined;
	}

	let processes: ProcessInfo[];
	try {
		const { stdout } = await promisify(execFile)('ps', PS_ARGS, { maxBuffer: 16 * 1024 * 1024 });
		processes = parseProcessTable(stdout);
	} catch {
		return undefined;
	}

	const active = vscode.window.activeTerminal;
	const candidates = [...vscode.window.terminals].reverse()
		.sort((a, b) => Number(b === active) - Number(a === active));
	for (const terminal of candidates) {
		const pid = await terminal.processId;
		if (pid !== undefined && hasForegroundProcess(processes, pid, isClaudeCodeCommand)) {
			return terminal;
		}
	}
	return undefined;
}

/**
 * Paste the prompt into Claude Code's input and reveal the terminal. Enter is
 * left to the user: the session may be showing a permission prompt, where a
 * keystroke would answer it.
 */
function pasteIntoTerminal(terminal: vscode.Terminal, prompt: string): void {
	// Bracketed paste makes the prompt's newlines part of the input rather
	// than Enter presses. Escape characters are dropped so the prompt cannot
	// end the paste early.
	const text = prompt.replace(/\x1b/g, '');
	terminal.sendText(`\x1b[200~${text}\x1b[201~`, false);
	terminal.show(false);
}
