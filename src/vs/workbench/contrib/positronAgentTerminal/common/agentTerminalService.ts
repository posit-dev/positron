/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IPositronAgentTerminalService = createDecorator<IPositronAgentTerminalService>('positronAgentTerminalService');

/** How many lines a read returns by default. */
export const DEFAULT_READ_LINES = 100;

/** The most lines a read returns. */
export const MAX_READ_LINES = 1_000;

export interface IAgentTerminalCreateOptions {
	/** The name shown in the terminal's tab. */
	name: string;
	cwd?: string | URI;
	env?: { [key: string]: string | null | undefined };
	/** Whether `env` replaces the inherited environment instead of adding to it. */
	strictEnv?: boolean;
	/** The shell to run, instead of the default profile's. */
	shellPath?: string;
	shellArgs?: string[] | string;
}

export interface IAgentTerminal {
	readonly id: string;
	/** The ID of whoever created it, typically an extension ID. */
	readonly ownerId: string;
	readonly name: string;
	/** Whether the shell has exited or the terminal was closed. */
	readonly exited: boolean;
	/** The shell's exit code, if it exited and reported one. */
	readonly exitCode: number | undefined;
}

export interface IAgentTerminalCommand {
	/** Unique within its terminal. */
	readonly id: string;
	readonly commandLine: string;
	readonly running: boolean;
	/** The exit code the shell reported, once the command finished. */
	readonly exitCode: number | undefined;
	/** When it started, in milliseconds since the epoch. */
	readonly startTime: number;
	readonly endTime: number | undefined;
	/** How many lines of output it has, including dropped lines. */
	readonly lineCount: number;
	/** How many of the oldest lines were dropped to bound memory. */
	readonly droppedLines: number;
	/** Whether output is missing because the window reloaded while the command ran. */
	readonly missingOutput: boolean;
}

export interface IAgentTerminalOutput {
	readonly command: IAgentTerminalCommand;
	/** The line number of the first line returned, 0-based. */
	readonly offset: number;
	/** Lines with escape sequences removed and long lines cut. */
	readonly lines: string[];
	/** Where the next read starts, or undefined if these lines reach the end of the output so far. */
	readonly nextOffset: number | undefined;
}

/**
 * Owns terminals that agents run commands in. Each terminal appears in the
 * Terminal pane with an agent icon. Commands run one at a time, and their
 * output is kept here, so a caller can read it again after the extension host
 * restarts. Terminals and their commands also survive a window reload, as long
 * as the terminal's shell does.
 */
export interface IPositronAgentTerminalService {
	readonly _serviceBrand: undefined;

	/**
	 * Creates a terminal and waits for its shell integration, which the
	 * service needs to tell where each command starts and ends.
	 *
	 * @throws If the shell exits or shell integration doesn't start.
	 */
	createTerminal(ownerId: string, options: IAgentTerminalCreateOptions): Promise<IAgentTerminal>;

	/** The terminals `ownerId` created and hasn't disposed. */
	getTerminals(ownerId: string): IAgentTerminal[];

	/**
	 * Runs a command line. Resolves when it finishes or after `waitMs`,
	 * whichever is first; a command still running can be waited on again.
	 *
	 * @throws If another command is running or the shell doesn't report the command starting.
	 */
	runCommand(ownerId: string, terminalId: string, commandLine: string, waitMs: number, token: CancellationToken): Promise<IAgentTerminalCommand>;

	/** Resolves when a command finishes or after `waitMs`, whichever is first. */
	waitForCommand(ownerId: string, terminalId: string, commandId: string, waitMs: number, token: CancellationToken): Promise<IAgentTerminalCommand>;

	/** The terminal's recent commands, oldest first. */
	getCommands(ownerId: string, terminalId: string): IAgentTerminalCommand[];

	/** Reads up to `limit` lines of a command's output, starting at line `offset`. */
	readOutput(ownerId: string, terminalId: string, commandId: string, offset: number, limit: number): IAgentTerminalOutput;

	/** Sends Ctrl+C to the terminal. */
	interrupt(ownerId: string, terminalId: string): Promise<void>;

	/** Shows the terminal in the Terminal pane. */
	show(ownerId: string, terminalId: string, preserveFocus: boolean): Promise<void>;

	/** Closes the terminal, killing its shell, and forgets its commands. */
	disposeTerminal(ownerId: string, terminalId: string): void;
}
