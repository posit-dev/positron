/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { execSync, exec } from 'child_process';
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';
import { ModuleSystemInfo } from './types.js';
import { getLog } from './logger.js';

/**
 * Shell configuration for executing module commands
 */
export interface ShellConfig {
	/** The shell executable name (e.g., 'bash', 'zsh') */
	name: string;
	/** The full path to the shell */
	path: string;
	/** Arguments to run a login shell with a command */
	loginArgs: string[];
	/** The init subdirectory name for this shell */
	initName: string;
	/** The command separator for chaining commands (e.g., '&&' or '; and') */
	chainOperator: string;
}

/**
 * Get the user's configured shell and its configuration.
 * Falls back to bash if the shell cannot be determined or is unsupported.
 */
export function getShellConfig(): ShellConfig {
	const shellPath = process.env.SHELL || '/bin/bash';
	const shellName = path.basename(shellPath);

	// Map shell names to their configurations
	// Note: Different shells have different syntax for command chaining
	const shellConfigs: Record<string, { loginArgs: string[]; initName: string; chainOperator: string }> = {
		'bash': { loginArgs: ['-l', '-c'], initName: 'bash', chainOperator: '&&' },
		'zsh': { loginArgs: ['-l', '-c'], initName: 'zsh', chainOperator: '&&' },
		'sh': { loginArgs: ['-l', '-c'], initName: 'sh', chainOperator: '&&' },
		'ksh': { loginArgs: ['-l', '-c'], initName: 'ksh', chainOperator: '&&' },
		// csh/tcsh don't have && operator, use ; which doesn't short-circuit
		'tcsh': { loginArgs: ['-l', '-c'], initName: 'tcsh', chainOperator: ';' },
		'csh': { loginArgs: ['-l', '-c'], initName: 'csh', chainOperator: ';' },
		// fish uses '; and' for short-circuit chaining
		'fish': { loginArgs: ['-l', '-c'], initName: 'fish', chainOperator: '; and' },
	};

	const config = shellConfigs[shellName];
	if (config) {
		return {
			name: shellName,
			path: shellPath,
			loginArgs: config.loginArgs,
			initName: config.initName,
			chainOperator: config.chainOperator,
		};
	}

	// Fallback to bash for unknown shells
	return {
		name: 'bash',
		path: '/bin/bash',
		loginArgs: ['-l', '-c'],
		initName: 'bash',
		chainOperator: '&&',
	};
}

/**
 * Build a shell command string for executing in a login shell.
 */
export function buildShellCommand(shell: ShellConfig, command: string): string {
	// Quote the command appropriately for the shell
	const quotedCommand = command.replace(/'/g, "'\\''");
	return `${shell.path} ${shell.loginArgs.join(' ')} '${quotedCommand}'`;
}

/**
 * Get module init paths for a specific shell.
 * Returns paths in priority order.
 */
function getModuleInitPaths(shell: ShellConfig): string[] {
	const initName = shell.initName;

	return [
		// Shell-specific profile.d scripts (these typically source the right init)
		'/etc/profile.d/modules.sh',
		'/etc/profile.d/lmod.sh',
		'/etc/profile.d/z00_lmod.sh',

		// Shell-specific init scripts for Lmod
		`/usr/share/lmod/lmod/init/${initName}`,
		`/opt/cray/pe/lmod/lmod/init/${initName}`,

		// Shell-specific init scripts for Environment Modules
		`/usr/share/Modules/init/${initName}`,
		'/usr/share/Modules/init/profile.sh',  // Generic fallback

		// Common alternative locations
		`/etc/lmod/init/${initName}`,
		`/opt/modules/init/${initName}`,
	];
}

/**
 * Check if modules are available via MODULEPATH environment variable.
 * If MODULEPATH is set and non-empty, modules may already be initialized.
 */
function checkModulePath(): boolean {
	const modulePath = process.env.MODULEPATH;
	return !!modulePath && modulePath.trim().length > 0;
}

/**
 * Detect if a module system is available and determine its type.
 */
export async function detectModuleSystem(
	customInitScript?: string
): Promise<ModuleSystemInfo> {
	const logger = getLog();
	const shell = getShellConfig();

	logger.debug(`Detecting module system using shell: ${shell.name} (${shell.path})`);

	// Module systems are only supported on Linux
	if (process.platform === 'win32' || process.platform === 'darwin') {
		return {
			available: false,
			type: 'unknown',
			command: 'module'
		};
	}

	// Check custom init script first
	if (customInitScript) {
		if (fs.existsSync(customInitScript)) {
			const type = await detectModuleType(customInitScript);
			return {
				available: true,
				type,
				initPath: customInitScript,
				command: 'module'
			};
		} else {
			logger.warn(`Custom module init script not found: ${customInitScript}`);
		}
	}

	// Check if MODULEPATH is set - this indicates modules may already be initialized
	if (checkModulePath()) {
		logger.debug(`MODULEPATH is set: ${process.env.MODULEPATH}`);
		const timeout = vscode.workspace.getConfiguration('positron.environmentModules').get<number>('moduleLoadTimeout', 5000);
		// Try to verify the module command is actually available
		try {
			const shellCommand = buildShellCommand(shell, 'type module');
			const result = execSync(shellCommand, {
				encoding: 'utf8',
				timeout,
				stdio: ['pipe', 'pipe', 'pipe']
			});
			if (result.includes('module is a') || result.includes('module is ')) {
				const type = await detectModuleTypeFromCommand(shell);
				logger.info(`Module system detected via MODULEPATH: type=${type}`);
				return {
					available: true,
					type,
					command: 'module'
				};
			}
		} catch (error: any) {
			// Check for timeout error
			if (error.killed && error.signal === 'SIGTERM') {
				logger.error(
					`Module detection timed out after ${timeout}ms. ` +
					`Increase the timeout using the 'positron.environmentModules.moduleLoadTimeout' setting.`
				);
			}
			// MODULEPATH is set but module command not available, continue searching
			logger.debug('MODULEPATH is set but module command not found in shell');
		}
	}

	// Check if 'module' command is already available (e.g., in login shells)
	const timeout = vscode.workspace.getConfiguration('positron.environmentModules').get<number>('moduleLoadTimeout', 5000);
	try {
		const shellCommand = buildShellCommand(shell, 'type module');
		const result = execSync(shellCommand, {
			encoding: 'utf8',
			timeout,
			stdio: ['pipe', 'pipe', 'pipe']
		});
		if (result.includes('module is a') || result.includes('module is ')) {
			const type = await detectModuleTypeFromCommand(shell);
			logger.info(`Module system detected via login shell: type=${type}`);
			return {
				available: true,
				type,
				command: 'module'
			};
		}
	} catch (error: any) {
		// Check for timeout error
		if (error.killed && error.signal === 'SIGTERM') {
			logger.error(
				`Module detection timed out after ${timeout}ms. ` +
				`Increase the timeout using the 'positron.environmentModules.moduleLoadTimeout' setting.`
			);
		}
		// Command not found in login shell, continue checking init scripts
	}

	// Search for shell-specific init scripts
	const initPaths = getModuleInitPaths(shell);
	for (const initPath of initPaths) {
		if (fs.existsSync(initPath)) {
			const type = await detectModuleType(initPath);
			logger.info(`Module system detected via init script: ${initPath}, type=${type}`);
			return {
				available: true,
				type,
				initPath,
				command: 'module'
			};
		}
	}

	logger.debug('No module system detected');
	return {
		available: false,
		type: 'unknown',
		command: 'module'
	};
}

/**
 * Detect module system type from init script content
 */
async function detectModuleType(initPath: string): Promise<'lmod' | 'environment-modules' | 'unknown'> {
	try {
		const content = fs.readFileSync(initPath, 'utf8');
		if (content.includes('LMOD') || content.includes('lmod')) {
			return 'lmod';
		}
		if (content.includes('MODULESHOME') || content.includes('Modules')) {
			return 'environment-modules';
		}
	} catch {
		// Ignore read errors
	}
	return 'unknown';
}

/**
 * Detect module system type by running module --version
 */
async function detectModuleTypeFromCommand(
	shell?: ShellConfig
): Promise<'lmod' | 'environment-modules' | 'unknown'> {
	const effectiveShell = shell || getShellConfig();
	const timeout = vscode.workspace.getConfiguration('positron.environmentModules').get<number>('moduleLoadTimeout', 5000);
	try {
		const shellCommand = buildShellCommand(effectiveShell, 'module --version 2>&1');
		const result = execSync(shellCommand, {
			encoding: 'utf8',
			timeout
		});
		if (result.toLowerCase().includes('lmod')) {
			return 'lmod';
		}
		if (result.includes('Modules') || result.includes('modules')) {
			return 'environment-modules';
		}
	} catch (error: any) {
		// Check for timeout error
		if (error.killed && error.signal === 'SIGTERM') {
			const logger = getLog();
			logger.error(
				`Detecting module type timed out after ${timeout}ms. ` +
				`Increase the timeout using the 'positron.environmentModules.moduleLoadTimeout' setting.`
			);
		}
		// Ignore other errors
	}
	return 'unknown';
}

/**
 * Get the version string from the module system.
 *
 * @param systemInfo Information about the detected module system
 * @returns Version string or undefined if unable to determine
 */
export async function getModuleSystemVersion(
	systemInfo: ModuleSystemInfo
): Promise<string | undefined> {
	if (!systemInfo.available) {
		return undefined;
	}

	const shell = getShellConfig();

	try {
		const initScript = systemInfo.initPath;
		const command = initScript
			? `source "${initScript}" ${shell.chainOperator} module --version 2>&1`
			: 'module --version 2>&1';
		const fullCommand = buildShellCommand(shell, command);
		const timeout = vscode.workspace.getConfiguration('positron.environmentModules').get<number>('moduleLoadTimeout', 5000);

		const result = execSync(fullCommand, {
			encoding: 'utf8',
			timeout,
			stdio: ['pipe', 'pipe', 'pipe']
		});

		// Parse version from output
		// Lmod typically outputs: "Modules based on Lua: Version 8.7.x  ..." or similar
		// Environment Modules: "Modules Release 5.x.x ..." or similar
		const lines = result.trim().split('\n');
		for (const line of lines) {
			// Look for version patterns
			const versionMatch = line.match(/(?:version|release)\s+(\d+\.\d+(?:\.\d+)?)/i);
			if (versionMatch) {
				return versionMatch[1];
			}
			// Lmod often has version in format like "Lmod 8.7"
			const lmodMatch = line.match(/lmod\s+(\d+\.\d+(?:\.\d+)?)/i);
			if (lmodMatch) {
				return lmodMatch[1];
			}
		}
		// Return first non-empty line as fallback
		return lines[0] || undefined;
	} catch (error: any) {
		// Check for timeout error
		if (error.killed && error.signal === 'SIGTERM') {
			const logger = getLog();
			const timeout = vscode.workspace.getConfiguration('positron.environmentModules').get<number>('moduleLoadTimeout', 5000);
			logger.error(
				`Getting module version timed out after ${timeout}ms. ` +
				`Increase the timeout using the 'positron.environmentModules.moduleLoadTimeout' setting.`
			);
		}
		return undefined;
	}
}

/**
 * Build a shell command that initializes the module system and loads modules.
 *
 * @param modules Array of module names to load
 * @param initScript Optional path to init script
 * @param shell Optional shell config for proper command chaining syntax
 * @returns Shell command string
 */
export function buildModuleLoadCommand(
	modules: string[],
	initScript?: string,
	shell?: ShellConfig
): string {
	const effectiveShell = shell || getShellConfig();
	const parts: string[] = [];

	// Add init script sourcing if needed
	if (initScript) {
		parts.push(`source "${initScript}"`);
	}

	// Add module load commands
	for (const mod of modules) {
		parts.push(`module load ${mod}`);
	}

	return parts.join(` ${effectiveShell.chainOperator} `);
}

/**
 * Execute a command with modules loaded and return the output.
 *
 * @param modules Modules to load
 * @param command Command to execute after loading modules
 * @param initScript Optional path to init script
 * @returns Command output
 */
export async function executeWithModules(
	modules: string[],
	command: string,
	initScript?: string
): Promise<string> {
	const logger = getLog();
	const shell = getShellConfig();
	const loadCommand = buildModuleLoadCommand(modules, initScript, shell);
	// Build the inner command with module loading
	const innerCommand = loadCommand
		? `${loadCommand} ${shell.chainOperator} ${command}`
		: command;
	const fullCommand = buildShellCommand(shell, innerCommand);

	return new Promise((resolve, reject) => {
		logger.debug(`Executing with shell ${shell.name}: ${fullCommand}`);
		const timeout = vscode.workspace.getConfiguration('positron.environmentModules').get<number>('moduleLoadTimeout', 5000);
		exec(fullCommand, {
			encoding: 'utf8',
			timeout
		}, (error, stdout, stderr) => {
			if (stdout) {
				logger.debug(stdout);
			}
			if (stderr) {
				logger.warn(stderr);
			}
			if (error) {
				// Check if this is a timeout error
				if (error.killed && error.signal === 'SIGTERM') {
					reject(new Error(
						`Module command timed out after ${timeout}ms. ` +
						`Increase the timeout using the 'positron.environmentModules.moduleLoadTimeout' setting.\n` +
						`Command: ${fullCommand}`
					));
				} else {
					const errorMsg = error.message ? error.message : JSON.stringify(error);
					reject(new Error(`Module command '${fullCommand}' failed: ${errorMsg}\n${stderr}`));
				}
			} else {
				resolve(stdout.trim());
			}
		});
	});
}
