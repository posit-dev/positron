/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { claudeCode } from './claudeCode';
import { codex } from './codex';
import { CodingAgent, sendPrompt } from './codingAgent';
import { ErrorActionKind, getErrorPrompt, UnsavedCode } from './errorPrompt';

/** The agents Fix and Explain can send errors to, in the order they are offered. */
const AGENTS: readonly CodingAgent[] = [claudeCode, codex];

/** Minimum time between availability checks triggered by the window regaining focus. */
const FOCUS_CHECK_INTERVAL = 30_000;

export function activate(context: vscode.ExtensionContext): void {
	// Offer each agent only while it is installed and able to take a prompt.
	// Checks run one at a time, so registrations always follow the latest
	// result; a check requested during another runs once that one finishes.
	const registrationsById = new Map<string, vscode.Disposable>();
	let isChecking = false;
	let isCheckRequested = false;
	let isDisposed = false;
	let lastCheckTime = 0;
	const updateRegistrations = async () => {
		if (isChecking) {
			isCheckRequested = true;
			return;
		}
		isChecking = true;
		try {
			do {
				isCheckRequested = false;
				lastCheckTime = Date.now();
				const availabilities = await Promise.all(AGENTS.map(agent => agent.isAvailable()));
				if (isDisposed) {
					return;
				}
				AGENTS.forEach((agent, i) => {
					const registration = registrationsById.get(agent.id);
					if (availabilities[i] && !registration) {
						registrationsById.set(agent.id, positron.ai.registerErrorActionHandler(agent.id, agent.label, {
							fix: errorContext => startSession(agent, 'fix', errorContext),
							explain: errorContext => startSession(agent, 'explain', errorContext),
						}));
					} else if (!availabilities[i] && registration) {
						registration.dispose();
						registrationsById.delete(agent.id);
					}
				});
			} while (isCheckRequested);
		} finally {
			isChecking = false;
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
		// when the user comes back to the window. Each check searches the
		// PATH, so skip it if one ran recently.
		vscode.window.onDidChangeWindowState(state => {
			if (state.focused && Date.now() - lastCheckTime >= FOCUS_CHECK_INTERVAL) {
				updateRegistrations();
			}
		}),
		{
			dispose: () => {
				isDisposed = true;
				registrationsById.forEach(registration => registration.dispose());
			}
		}
	);
}

/** Open a new agent session with the error from a Fix/Explain action. */
async function startSession(agent: CodingAgent, kind: ErrorActionKind, context: positron.ai.ErrorActionContext): Promise<void> {
	const getPath = (uri: vscode.Uri) => vscode.workspace.asRelativePath(uri);
	const prompt = getErrorPrompt(kind, context, getPath, await getMcpServerName(agent), getUnsavedCode(context.location));
	await sendPrompt(agent, prompt);
}

/**
 * The failing notebook cell's or Quarto chunk's code, read from the open
 * document when the agent can't read it from the file.
 * @returns The code, or undefined when the document is saved, closed, or the
 *   error has no notebook or Quarto location.
 */
function getUnsavedCode(location: positron.ai.ErrorLocation | undefined): UnsavedCode | undefined {
	if (location?.kind === 'notebook' && location.cellIndex !== undefined) {
		const uri = location.uri.toString();
		const notebook = vscode.workspace.notebookDocuments.find(document => document.uri.toString() === uri);
		if (!notebook || !(notebook.isUntitled || notebook.isDirty) || location.cellIndex >= notebook.cellCount) {
			return undefined;
		}
		const cell = notebook.cellAt(location.cellIndex).document;
		return { code: cell.getText(), languageId: cell.languageId, isUntitled: notebook.isUntitled };
	}
	if (location?.kind === 'quarto') {
		const uri = location.uri.toString();
		const document = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri);
		if (!document || !(document.isUntitled || document.isDirty) || location.endLine > document.lineCount) {
			return undefined;
		}
		const range = new vscode.Range(location.startLine - 1, 0, location.endLine - 1, Number.MAX_SAFE_INTEGER);
		return { code: document.getText(range), languageId: location.languageId, isUntitled: document.isUntitled };
	}
	return undefined;
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
