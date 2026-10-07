/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { isPastClaudeCodeTrustPrompt, readConfig } from './agentTrust';
import { getAgentLaunch } from './agentLaunch';
import { AgentProblem, AgentProblemAction, CodingAgent, startInTerminal } from './codingAgent';
import { isClaudeCodeCommand } from './foregroundProcess';
import { ClaudeCodeSurface, getClaudeCodeSurface } from './claudeCodeSurface';

/** Identifier of Anthropic's Claude Code extension. */
const CLAUDE_CODE_EXTENSION_ID = 'anthropic.claude-code';

/** Claude Code's script in its npm package. */
const CLAUDE_CODE_NPM_SCRIPT = '@anthropic-ai/claude-code/cli.js';

/** How long the launching notification shows, as in Claude Code's own terminals. */
const LAUNCHING_NOTIFICATION_DURATION = 2000;

/** Claude Code, through its VS Code extension's chat or terminal. */
export const claudeCode: CodingAgent = {
	id: 'claude-code',
	label: 'Claude Code',
	isInstalled,
	getProblem,
	// Its chat can only start new conversations; its terminal sessions can be pasted into.
	canContinueChat: () => getSurface() === 'terminal',
	isAgentCommand: isClaudeCodeCommand,
	isPastTrustPrompt,
	startNew,
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

/** Claude Code counts as installed while its VS Code extension is. */
async function isInstalled(): Promise<boolean> {
	return vscode.extensions.getExtension(CLAUDE_CODE_EXTENSION_ID) !== undefined;
}

/** Why Claude Code can't take a prompt on the surface the user prefers. */
async function getProblem(): Promise<AgentProblem | undefined> {
	const extension = vscode.extensions.getExtension(CLAUDE_CODE_EXTENSION_ID);
	if (!extension) {
		return undefined;
	}
	const openUseTerminalSetting: AgentProblemAction = {
		title: vscode.l10n.t('Open Settings'),
		run: () => vscode.commands.executeCommand('workbench.action.openSettings', 'claudeCode.useTerminal'),
	};
	switch (getSurface()) {
		case 'chat':
			return undefined;
		case 'terminal':
			return await getAgentLaunch('claude', CLAUDE_CODE_NPM_SCRIPT) ? undefined : {
				message: vscode.l10n.t(
					'Claude Code is set to open in a terminal, but the claude command was not found on the PATH. Install the Claude Code CLI, or turn off Claude Code: Use Terminal to use its chat.'
				),
				actions: [openUseTerminalSetting],
			};
		case undefined:
			return {
				message: vscode.l10n.t(
					'Claude Code {0} is too old to receive errors in its chat. Update it, or turn on Claude Code: Use Terminal.',
					extension.packageJSON.version
				),
				actions: [
					{
						title: vscode.l10n.t('Show Extension'),
						run: () => vscode.commands.executeCommand('extension.open', CLAUDE_CODE_EXTENSION_ID),
					},
					openUseTerminalSetting,
				],
			};
	}
}

/** Open a new Claude Code session with the prompt. */
async function startNew(prompt: string): Promise<void> {
	// Problems are reported before a session starts, but Claude Code can be
	// uninstalled or its settings changed in between.
	switch (getSurface()) {
		case 'chat':
			return openChat(prompt);
		case 'terminal':
			return openTerminal(prompt);
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

/**
 * Start `claude` in a new terminal, which sends the prompt immediately.
 *
 * Claude Code's own `claude-vscode.terminal.open` types the command into a
 * shell, which cuts a multi-line prompt at its first newline and leaks the
 * rest as keystrokes. Its terminals run the same `claude` from the PATH, and
 * the extension's connection to the CLI reaches every terminal through its
 * environment, so a terminal of our own works the same.
 */
async function openTerminal(prompt: string): Promise<void> {
	const launch = await getAgentLaunch('claude', CLAUDE_CODE_NPM_SCRIPT);
	if (!launch) {
		throw new Error(vscode.l10n.t('Claude Code is not installed: `claude` was not found on the PATH.'));
	}
	// Match the terminals Claude Code opens itself: a brief notification while
	// it starts, then an editor tab beside the active editor, with its logo,
	// not restored after a reload. The terminal closes when `claude` exits.
	vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Claude Code launching...') },
		() => new Promise(resolve => setTimeout(resolve, LAUNCHING_NOTIFICATION_DURATION)),
	);
	const extension = vscode.extensions.getExtension(CLAUDE_CODE_EXTENSION_ID);
	startInTerminal(launch, prompt, {
		name: 'Claude Code',
		iconPath: extension && vscode.Uri.joinPath(extension.extensionUri, 'resources', 'claude-logo.svg'),
		location: { viewColumn: vscode.ViewColumn.Beside },
		isTransient: true,
	});
}

/** Whether Claude Code is past its folder-trust prompt in a directory. */
function isPastTrustPrompt(directory: string): boolean {
	// Claude Code keeps its state in `.claude.json`, beside its config
	// directory unless CLAUDE_CONFIG_DIR moves it.
	const configDirectory = process.env.CLAUDE_CONFIG_DIR ?? os.homedir();
	return readConfig(path.join(configDirectory, '.claude.json'), config => isPastClaudeCodeTrustPrompt(config, directory));
}
