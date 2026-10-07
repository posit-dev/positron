/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { claudeCode } from './claudeCode';
import { codex } from './codex';
import { AgentProblem, CodingAgent, sendPrompt } from './codingAgent';
import { ErrorActionKind, getErrorPrompt, UnsavedState } from './errorPrompt';

/** The agents Fix and Explain can send errors to, in the order they are offered. */
const AGENTS: readonly CodingAgent[] = [claudeCode, codex];

/** The ai.errorActions.agent setting, within the `ai` section. */
const AGENT_SETTING = 'errorActions.agent';

/** Minimum time between availability checks triggered by the window regaining focus. */
const FOCUS_CHECK_INTERVAL = 30_000;

export function activate(context: vscode.ExtensionContext): void {
	// Offer each agent while it is installed. An installed agent that can't
	// take a prompt (e.g. a setting needs changing) stays on offer and explains
	// the problem when it's used or selected.
	const registrationsById = new Map<string, positron.ai.ErrorActionHandlerRegistration>();
	let isDisposed = false;
	context.subscriptions.push({
		dispose: () => {
			isDisposed = true;
			registrationsById.forEach(registration => registration.dispose());
		}
	});

	// Checks run one at a time, so registrations always follow the latest
	// result; a check requested during another runs once that one finishes.
	let isChecking = false;
	let isCheckRequested = false;
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
				const installed = await Promise.all(AGENTS.map(agent => agent.isInstalled()));
				if (isDisposed) {
					return;
				}
				AGENTS.forEach((agent, i) => {
					let registration = registrationsById.get(agent.id);
					if (!installed[i]) {
						registration?.dispose();
						registrationsById.delete(agent.id);
						return;
					}
					if (!registration) {
						registration = positron.ai.registerErrorActionHandler(agent.id, agent.label, {
							fix: errorContext => startSession(agent, 'fix', errorContext),
							explain: errorContext => startSession(agent, 'explain', errorContext),
						});
						registrationsById.set(agent.id, registration);
					}
					registration.canContinueChat = agent.canContinueChat();
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
		watchAgentSelection(),
	);
}

/**
 * When the user picks one of these agents for Fix and Explain and it can't
 * take a prompt, say why and how to fix it rather than waiting for the first
 * error. Compares each settings scope (User, Workspace, folder) with its last
 * value, so a pick in one scope is noticed even when another overrides it.
 */
function watchAgentSelection(): vscode.Disposable {
	const getValues = () => {
		const inspected = vscode.workspace.getConfiguration('ai').inspect<string>(AGENT_SETTING);
		return [inspected?.globalValue, inspected?.workspaceValue, inspected?.workspaceFolderValue];
	};
	let previousValues = getValues();
	return vscode.workspace.onDidChangeConfiguration(async e => {
		if (!e.affectsConfiguration(`ai.${AGENT_SETTING}`)) {
			return;
		}
		const values = getValues();
		const pickedIds = new Set(values.filter((value, i) => value !== previousValues[i]));
		previousValues = values;
		for (const agent of AGENTS.filter(agent => pickedIds.has(agent.id))) {
			const problem = await agent.getProblem();
			if (problem) {
				showProblem(problem);
			}
		}
	});
}

/** Show an agent's problem, with buttons to fix it. */
async function showProblem(problem: AgentProblem): Promise<void> {
	const choice = await vscode.window.showWarningMessage(problem.message, ...problem.actions.map(action => action.title));
	await problem.actions.find(action => action.title === choice)?.run();
}

/** Open a new agent session with the error from a Fix/Explain action. */
async function startSession(agent: CodingAgent, kind: ErrorActionKind, context: positron.ai.ErrorActionContext): Promise<void> {
	// Explain why the agent can't take the error, rather than failing. Don't
	// wait for the user to answer the notification.
	const problem = await agent.getProblem();
	if (problem) {
		void showProblem(problem);
		return;
	}
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
