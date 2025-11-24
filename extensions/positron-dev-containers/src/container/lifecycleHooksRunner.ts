/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as os from 'os';
import { getLogger } from '../common/logger';
import { Configuration } from '../common/configuration';
import { DevContainerLifecycleHook, LifecycleCommand } from '../spec/spec-common/injectHeadless';

/**
 * Configuration for lifecycle hooks execution
 */
export interface LifecycleHooksConfig {
	/**
	 * Container ID
	 */
	containerId: string;

	/**
	 * Container name
	 */
	containerName: string;

	/**
	 * Workspace folder on host
	 */
	workspaceFolder: string;

	/**
	 * Remote workspace folder in container
	 */
	remoteWorkspaceFolder: string;

	/**
	 * Dev container configuration
	 */
	devContainerConfig: any;

	/**
	 * Terminal to show output in
	 */
	terminal: vscode.Terminal;
}

/**
 * Runs lifecycle hooks for a dev container by generating commands and sending them to the terminal.
 * This provides clean output in the terminal with proper TTY support.
 */
export async function runDevContainerLifecycleHooks(config: LifecycleHooksConfig): Promise<void> {
	const logger = getLogger();
	const vsconfig = Configuration.getInstance();
	const dockerPath = vsconfig.getDockerPath();
	const isWindows = os.platform() === 'win32';

	logger.info('==> Running lifecycle hooks...');

	// Build map of hooks to run
	const hooksToRun = buildLifecycleHooksMap(config.devContainerConfig);

	// Lifecycle hooks execution order (based on spec library)
	const hookOrder: DevContainerLifecycleHook[] = [
		'onCreateCommand',
		'updateContentCommand',
		'postCreateCommand',
		'postStartCommand',
		'postAttachCommand',
	];

	// Generate and send commands to terminal
	for (const hookName of hookOrder) {
		const command = hooksToRun[hookName];
		if (!command) {
			continue;
		}

		logger.info(`Running ${hookName}...`);

		// Generate the docker exec command
		const execCommand = buildDockerExecCommand(
			dockerPath,
			config.containerId,
			config.remoteWorkspaceFolder,
			command,
			hookName,
			isWindows
		);

		// Send to terminal for execution
		config.terminal.sendText(execCommand);
	}
}

/**
 * Builds a map of lifecycle hooks from the dev container configuration
 */
function buildLifecycleHooksMap(devContainerConfig: any): Partial<Record<DevContainerLifecycleHook, LifecycleCommand>> {
	const map: Partial<Record<DevContainerLifecycleHook, LifecycleCommand>> = {};

	const hooks: DevContainerLifecycleHook[] = [
		'initializeCommand',
		'onCreateCommand',
		'updateContentCommand',
		'postCreateCommand',
		'postStartCommand',
		'postAttachCommand',
	];

	for (const hook of hooks) {
		if (devContainerConfig[hook]) {
			map[hook] = devContainerConfig[hook];
		}
	}

	return map;
}

/**
 * Builds a docker exec command to run a lifecycle hook
 */
function buildDockerExecCommand(
	dockerPath: string,
	containerId: string,
	remoteCwd: string,
	command: LifecycleCommand,
	hookName: string,
	isWindows: boolean
): string {
	// Convert command to shell script
	let shellCommand: string;

	if (typeof command === 'string') {
		shellCommand = command;
	} else if (Array.isArray(command)) {
		// Array of commands - run them sequentially
		shellCommand = command.join(' && ');
	} else if (typeof command === 'object') {
		// Object with named commands - run them sequentially
		const commands = Object.entries(command).map(([name, cmd]) => {
			const cmdStr = Array.isArray(cmd) ? cmd.join(' ') : cmd;
			return `echo "Running ${name}..." && ${cmdStr}`;
		});
		shellCommand = commands.join(' && ');
	} else {
		return '';
	}

	// Escape the command for the shell
	const escapedCommand = isWindows
		? shellCommand.replace(/"/g, '`"')
		: shellCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');

	// Build the full command
	if (isWindows) {
		return `Write-Host "==> Running ${hookName}..."; ${dockerPath} exec -w "${remoteCwd}" ${containerId} sh -c "${escapedCommand}"`;
	} else {
		return `echo "==> Running ${hookName}..."; ${dockerPath} exec -w "${remoteCwd}" ${containerId} sh -c "${escapedCommand}"`;
	}
}
