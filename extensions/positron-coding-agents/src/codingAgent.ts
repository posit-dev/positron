/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { canInlineBody, ErrorPrompt, formatFilePrompt, formatInlinePrompt } from './errorPrompt';
import { hasForegroundProcess, parseProcessTable, ProcessInfo, PS_ARGS } from './foregroundProcess';

/** Directory for error details @-mentioned from prompts. */
const ERROR_DIR = path.join(os.tmpdir(), 'positron-coding-agents');

/** A coding agent that Fix and Explain can send errors to. */
export interface CodingAgent {
	/**
	 * Value of the agent in the ai.errorActions.target setting. Matches the
	 * agent's ID in positron-supervisor's MCP agent table, which is how the
	 * supervisor is asked whether the agent can reach Positron's MCP server.
	 */
	readonly id: string;

	/** Name shown in the UI. */
	readonly label: string;

	/** Whether the agent is installed and can take a prompt. */
	isAvailable(): boolean;

	/** Whether a process's command line runs the agent's terminal UI. */
	isAgentCommand(args: string): boolean;

	/** Start a new session with the prompt. */
	startNew(prompt: ErrorPrompt): Promise<void>;
}

/**
 * Send a prompt to the agent's session in a terminal, if one is running in
 * the foreground of one, or start a new session.
 */
export async function sendPrompt(agent: CodingAgent, prompt: ErrorPrompt): Promise<void> {
	const terminal = await findAgentTerminal(agent);
	if (terminal) {
		return pasteIntoTerminal(terminal, canInlineBody(prompt) ? formatInlinePrompt(prompt) : await formatPromptWithFile(prompt));
	}
	return agent.startNew(prompt);
}

/** Format a single-line prompt, moving its body (if any) to a file it @-mentions. */
export async function formatPromptWithFile(prompt: ErrorPrompt): Promise<string> {
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

/**
 * Find a terminal whose foreground job is the agent, preferring the active
 * terminal, then the most recently created.
 * @returns The terminal, or undefined when there is none or the process table
 *   cannot be read (e.g. on Windows, which has no `ps`).
 */
async function findAgentTerminal(agent: CodingAgent): Promise<vscode.Terminal | undefined> {
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
		if (pid !== undefined && hasForegroundProcess(processes, pid, args => agent.isAgentCommand(args))) {
			return terminal;
		}
	}
	return undefined;
}

/**
 * Paste the prompt into the agent's input and reveal the terminal. Enter is
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
