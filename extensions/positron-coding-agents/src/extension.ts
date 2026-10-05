/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { claudeCode } from './claudeCode';
import { codex, gemini } from './cliAgents';
import { CodingAgent } from './codingAgent';
import { ErrorActionKind, getErrorPrompt } from './errorPrompt';

/** The agents Fix and Explain can send errors to, in the order they are offered. */
const AGENTS: readonly CodingAgent[] = [claudeCode, codex, gemini];

export function activate(context: vscode.ExtensionContext): void {
	// Offer each agent only while it is installed and able to take a prompt.
	const registrationsById = new Map<string, vscode.Disposable>();
	const updateRegistrations = () => {
		for (const agent of AGENTS) {
			const registration = registrationsById.get(agent.id);
			const available = agent.isAvailable();
			if (available && !registration) {
				registrationsById.set(agent.id, positron.ai.registerErrorActionHandler(agent.id, agent.label, {
					fix: errorContext => startSession(agent, 'fix', errorContext),
					explain: errorContext => startSession(agent, 'explain', errorContext),
				}));
			} else if (!available && registration) {
				registration.dispose();
				registrationsById.delete(agent.id);
			}
		}
	};

	updateRegistrations();
	context.subscriptions.push(
		vscode.extensions.onDidChange(updateRegistrations),
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('claudeCode.useTerminal')) {
				updateRegistrations();
			}
		}),
		// Nothing announces a CLI being installed or removed, so look again
		// whenever the user comes back to the window.
		vscode.window.onDidChangeWindowState(state => {
			if (state.focused) {
				updateRegistrations();
			}
		}),
		{ dispose: () => registrationsById.forEach(registration => registration.dispose()) }
	);
}

/** Open a new agent session with the error from a Fix/Explain action. */
async function startSession(agent: CodingAgent, kind: ErrorActionKind, context: positron.ai.ErrorActionContext): Promise<void> {
	const getPath = (uri: vscode.Uri) => vscode.workspace.asRelativePath(uri);
	const prompt = getErrorPrompt(kind, context, getPath, await getMcpServerName(agent));
	await agent.start(prompt);
}

/**
 * The name an agent knows Positron's MCP server by, from the Kernel
 * Supervisor that configured it.
 * @returns The name, or undefined when the server is off, the agent is not
 *   configured to use it, or the supervisor cannot be asked.
 */
async function getMcpServerName(agent: CodingAgent): Promise<string | undefined> {
	try {
		const name = await vscode.commands.executeCommand<unknown>('positron.mcp.getConfiguredServerName', agent.id);
		return typeof name === 'string' ? name : undefined;
	} catch {
		return undefined;
	}
}
