/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { ErrorActionRequest, formatPrompt, formatTerminalPrompt, getClaudeCodeSurface } from './claudeCodeLaunch';

/** Identifier of Anthropic's Claude Code extension. */
const CLAUDE_CODE_EXTENSION_ID = 'anthropic.claude-code';

/** Directory for error context files @-mentioned from terminal prompts. */
const CONTEXT_DIR = path.join(os.tmpdir(), 'positron-claude-code');

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron-claude-code.sendError', sendError)
	);
}

/** Open a new Claude Code session with the error from a Fix/Explain action. */
async function sendError(request: ErrorActionRequest): Promise<void> {
	// Positron only offers this target when Claude Code is installed, but it
	// can be uninstalled or disabled after the buttons render.
	const claudeCode = vscode.extensions.getExtension(CLAUDE_CODE_EXTENSION_ID);
	if (!claudeCode) {
		vscode.window.showErrorMessage(vscode.l10n.t('The Claude Code extension is not installed.'));
		return;
	}

	const version: string = claudeCode.packageJSON.version ?? '0.0.0';
	const useTerminal = vscode.workspace.getConfiguration('claudeCode').get<boolean>('useTerminal') === true;
	const surface = getClaudeCodeSurface(version, useTerminal);
	switch (surface.kind) {
		case 'outdated':
			vscode.window.showErrorMessage(vscode.l10n.t(
				'Sending errors to Claude Code requires Claude Code {0} or later. You have {1}.',
				surface.minimumVersion,
				version
			));
			return;
		case 'chat':
			// An undefined session ID starts a new conversation with the prompt
			// filled into the input, ready for the user to send.
			await vscode.commands.executeCommand('claude-vscode.editor.open', undefined, formatPrompt(request));
			return;
		case 'terminal': {
			const contextPath = request.context ? await writeContextFile(request.context) : undefined;
			await vscode.commands.executeCommand('claude-vscode.terminal.open', formatTerminalPrompt(request, contextPath));
			return;
		}
	}
}

/**
 * Write error context to a temp file for a terminal prompt to @-mention. Left
 * in place so the session can re-read it; the OS clears the temp directory.
 */
async function writeContextFile(contextText: string): Promise<string> {
	await fs.mkdir(CONTEXT_DIR, { recursive: true });
	const contextPath = path.join(CONTEXT_DIR, `error-${randomUUID()}.txt`);
	await fs.writeFile(contextPath, contextText, 'utf8');
	return contextPath;
}
