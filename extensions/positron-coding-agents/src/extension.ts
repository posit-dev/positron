/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { claudeCode } from './claudeCode';
import { codex } from './codex';
import { CodingAgent, sendPrompt } from './codingAgent';
import { ErrorActionKind, getErrorPrompt, UnsavedState } from './errorPrompt';

/** The agents Fix and Explain can send errors to, in the order they are offered. */
const AGENTS: readonly CodingAgent[] = [claudeCode, codex];

/** Minimum time between availability checks triggered by the window regaining focus. */
const FOCUS_CHECK_INTERVAL = 30_000;

export function activate(context: vscode.ExtensionContext): void {
	// Register each agent once; it is offered while its availability context
	// key, kept current below, is true.
	const registrations = AGENTS.map(agent => positron.ai.registerErrorActionHandler(agent.id, agent.label, {
		when: getAvailableKey(agent),
		fix: errorContext => startSession(agent, 'fix', errorContext),
		explain: errorContext => startSession(agent, 'explain', errorContext),
	}));
	context.subscriptions.push(...registrations);

	// Checks run one at a time, so the context keys always follow the latest
	// result; a check requested during another runs once that one finishes.
	let isChecking = false;
	let isCheckRequested = false;
	let lastCheckTime = 0;
	const updateAvailability = async () => {
		if (isChecking) {
			isCheckRequested = true;
			return;
		}
		isChecking = true;
		try {
			do {
				isCheckRequested = false;
				lastCheckTime = Date.now();
				const reasons = await Promise.all(AGENTS.map(agent => agent.getUnavailableReason()));
				await Promise.all(AGENTS.map((agent, i) => {
					registrations[i].unavailableReason = reasons[i];
					return vscode.commands.executeCommand('setContext', getAvailableKey(agent), reasons[i] === undefined);
				}));
			} while (isCheckRequested);
		} finally {
			isChecking = false;
		}
	};

	updateAvailability();
	context.subscriptions.push(
		vscode.extensions.onDidChange(updateAvailability),
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('claudeCode.useTerminal')) {
				updateAvailability();
			}
		}),
		// Nothing announces a CLI being installed or removed, so look again
		// when the user comes back to the window. Each check searches the
		// PATH, so skip it if one ran recently.
		vscode.window.onDidChangeWindowState(state => {
			if (state.focused && Date.now() - lastCheckTime >= FOCUS_CHECK_INTERVAL) {
				updateAvailability();
			}
		})
	);
}

/** Context key that is true while an agent can take errors. */
function getAvailableKey(agent: CodingAgent): string {
	return `positronCodingAgents.${agent.id}.available`;
}

/** Open a new agent session with the error from a Fix/Explain action. */
async function startSession(agent: CodingAgent, kind: ErrorActionKind, context: positron.ai.ErrorActionContext): Promise<void> {
	const getPath = (uri: vscode.Uri) => vscode.workspace.asRelativePath(uri);
	const prompt = getErrorPrompt(kind, context, getPath, await getMcpServerName(agent), getUnsavedState(context.location));
	await sendPrompt(agent, prompt, context.chat);
}

/**
 * How the document of a failing notebook cell or Quarto chunk differs from
 * its file, in which case the agent can't read the code from the file.
 * @returns The state, or undefined when the document is saved or closed, or
 *   the error has no notebook or Quarto location.
 */
function getUnsavedState(location: positron.ai.ErrorLocation | undefined): UnsavedState | undefined {
	if (location?.kind !== 'notebook' && location?.kind !== 'quarto') {
		return undefined;
	}
	const uri = location.uri.toString();
	const document = location.kind === 'notebook'
		? vscode.workspace.notebookDocuments.find(document => document.uri.toString() === uri)
		: vscode.workspace.textDocuments.find(document => document.uri.toString() === uri);
	if (document?.isUntitled) {
		return 'untitled';
	}
	return document?.isDirty ? 'dirty' : undefined;
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
