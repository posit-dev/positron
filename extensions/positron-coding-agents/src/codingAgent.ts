/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { promisify } from 'node:util';
import type * as positron from 'positron';
import * as vscode from 'vscode';
import { AgentLaunch } from './agentLaunch';
import { findForegroundProcess, parseProcessTable, ProcessInfo, PS_ARGS } from './foregroundProcess';

/**
 * Why an installed agent can't take a prompt, and what the user can do about
 * it, e.g. change a setting.
 */
export interface AgentProblem {
	readonly message: string;
	readonly actions: readonly AgentProblemAction[];
}

/** A button on an {@link AgentProblem}'s notification. */
export interface AgentProblemAction {
	readonly title: string;
	run(): Thenable<unknown>;
}

/** A coding agent that Fix and Explain can send errors to. */
export interface CodingAgent {
	/**
	 * Value of the agent in the ai.errorActions.agent setting. Matches the
	 * agent's ID in positron-supervisor's MCP agent table, which is how the
	 * supervisor is asked whether the agent can reach Positron's MCP server.
	 */
	readonly id: string;

	/** Name shown in the UI. */
	readonly label: string;

	/** Whether the agent is installed, which is when Fix and Explain offer it. */
	isInstalled(): Promise<boolean>;

	/**
	 * Why the installed agent can't take a prompt.
	 * @returns The problem, or undefined when it can.
	 */
	getProblem(): Promise<AgentProblem | undefined>;

	/**
	 * Whether the agent can continue the current chat, by pasting into its
	 * session in a terminal.
	 */
	canContinueChat(): boolean;

	/** Whether a process's command line runs the agent's terminal UI. */
	isAgentCommand(args: string): boolean;

	/**
	 * Whether a session started in a directory is past the agent's
	 * folder-trust prompt, which would discard a pasted prompt.
	 */
	isPastTrustPrompt(directory: string): boolean;

	/** Start a new session with the prompt. */
	startNew(prompt: string): Promise<void>;
}

/**
 * Send a prompt to the agent. To continue the current chat, paste it into
 * the agent's session in a terminal, if one is running in the foreground of
 * one; otherwise start a new session.
 */
export async function sendPrompt(agent: CodingAgent, prompt: string, chat: positron.ai.ErrorActionChat): Promise<void> {
	const terminal = chat === 'current' ? await findAgentTerminal(agent) : undefined;
	if (terminal) {
		return pasteIntoTerminal(terminal, prompt);
	}
	return agent.startNew(prompt);
}

/**
 * Start an agent's CLI in a new terminal, with the prompt as its last
 * argument. The CLI is the terminal's process rather than a command typed
 * into a shell, so the prompt needs no shell quoting and keeps its newlines.
 */
export function startInTerminal(
	launch: AgentLaunch,
	prompt: string,
	options: Omit<vscode.TerminalOptions, 'shellPath' | 'shellArgs'>,
): void {
	const terminal = vscode.window.createTerminal({ ...options, shellPath: launch.command, shellArgs: [...launch.args, prompt] });
	terminal.show();
}

/**
 * Find a terminal whose foreground job is the agent, ready for a prompt,
 * preferring the active terminal, then the most recently created.
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
		const agentProcess = pid === undefined
			? undefined
			: findForegroundProcess(processes, pid, args => agent.isAgentCommand(args));
		if (!agentProcess) {
			continue;
		}
		// Skip a session that may still be asking whether to trust its
		// directory. A directory that can't be found is given the benefit of
		// the doubt.
		const directory = await getWorkingDirectory(agentProcess.pid);
		if (directory === undefined || agent.isPastTrustPrompt(directory)) {
			return terminal;
		}
	}
	return undefined;
}

/**
 * Find a process's working directory.
 * @returns The directory, or undefined when it can't be read.
 */
async function getWorkingDirectory(pid: number): Promise<string | undefined> {
	try {
		if (os.platform() === 'linux') {
			return await fs.promises.readlink(`/proc/${pid}/cwd`);
		}
		// `-Fn` prints fields one per line: `p<pid>`, `fcwd`, `n<path>`.
		const { stdout } = await promisify(execFile)('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
		return stdout.split('\n').find(line => line.startsWith('n'))?.slice(1);
	} catch {
		return undefined;
	}
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
