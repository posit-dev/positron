/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Command generation utilities for dev containers.
 * This module allows generating docker commands without executing them,
 * useful for terminal-based execution.
 */

/**
 * Represents a docker command with progress information
 */
export interface GeneratedCommand {
	/** The command to execute (e.g., 'docker') */
	command: string;
	/** Arguments for the command */
	args: string[];
	/** Human-readable description of what this command does */
	description: string;
	/** Environment variables to set */
	env?: NodeJS.ProcessEnv;
	/** Working directory for the command */
	cwd?: string;
}

/**
 * Result of command generation for provision/build operations
 */
export interface GeneratedCommands {
	/** All commands to execute in sequence */
	commands: GeneratedCommand[];
	/** The container ID (if known in advance, otherwise set after creation) */
	containerId?: string;
	/** The expected container name */
	containerName?: string;
	/** The remote workspace folder path */
	remoteWorkspaceFolder?: string;
}

/**
 * Options for command generation mode
 */
export interface CommandGenerationOptions {
	/** If true, generate commands instead of executing them */
	dryRun: boolean;
	/** Callback to receive generated commands */
	onCommand?: (command: GeneratedCommand) => void;
}

/**
 * Context for accumulating generated commands
 */
export class CommandGenerationContext {
	private commands: GeneratedCommand[] = [];

	addCommand(command: GeneratedCommand) {
		this.commands.push(command);
	}

	getCommands(): GeneratedCommand[] {
		return [...this.commands];
	}

	clear() {
		this.commands = [];
	}
}

/**
 * Escapes a shell argument for safe execution
 */
export function escapeShellArg(arg: string): string {
	// If the argument contains special characters, quote it
	if (/[^\w@%+=:,./-]/.test(arg)) {
		// Escape single quotes by replacing ' with '\''
		return `'${arg.replace(/'/g, "'\\''")}'`;
	}
	return arg;
}

/**
 * Formats a command for shell execution
 */
export function formatCommandForShell(cmd: GeneratedCommand): string {
	const parts = [cmd.command, ...cmd.args.map(escapeShellArg)];
	return parts.join(' ');
}

/**
 * Formats a command with echo statement for terminal display
 */
export function formatCommandWithEcho(cmd: GeneratedCommand): string {
	const echoLine = `echo "==> ${cmd.description.replace(/"/g, '\\"')}"`;
	const commandLine = formatCommandForShell(cmd);
	return `${echoLine}\n${commandLine}`;
}
