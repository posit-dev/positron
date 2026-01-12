/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { execSync, exec } from 'child_process';
import * as fs from 'fs';
import { ModuleSystemInfo } from './types.js';
import { getLog } from './logger.js';

/**
 * Common locations for module system initialization scripts
 */
const MODULE_INIT_PATHS = [
	'/etc/profile.d/modules.sh',           // Environment Modules
	'/etc/profile.d/lmod.sh',              // Lmod
	'/usr/share/lmod/lmod/init/bash',      // Lmod alternative
	'/opt/cray/pe/lmod/lmod/init/bash',    // Cray systems
	'/usr/share/Modules/init/bash',        // Environment Modules
	'/etc/profile.d/z00_lmod.sh',          // Some HPC systems
];

/**
 * Detect if a module system is available and determine its type.
 */
export async function detectModuleSystem(
	customInitScript?: string
): Promise<ModuleSystemInfo> {
	// Module systems are typically only available on Unix-like systems
	if (process.platform === 'win32') {
		return {
			available: false,
			type: 'unknown',
			command: 'module'
		};
	}

	// Check custom init script first
	if (customInitScript && fs.existsSync(customInitScript)) {
		const type = await detectModuleType(customInitScript);
		return {
			available: true,
			type,
			initPath: customInitScript,
			command: 'module'
		};
	}

	// Check if 'module' command is already available (e.g., in login shells)
	try {
		const result = execSync('bash -l -c "type module"', {
			encoding: 'utf8',
			timeout: 5000,
			stdio: ['pipe', 'pipe', 'pipe']
		});
		if (result.includes('module is a')) {
			return {
				available: true,
				type: await detectModuleTypeFromCommand(),
				command: 'module'
			};
		}
	} catch {
		// Command not found in login shell, continue checking init scripts
	}

	// Search for init scripts
	for (const initPath of MODULE_INIT_PATHS) {
		if (fs.existsSync(initPath)) {
			const type = await detectModuleType(initPath);
			return {
				available: true,
				type,
				initPath,
				command: 'module'
			};
		}
	}

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
async function detectModuleTypeFromCommand(): Promise<'lmod' | 'environment-modules' | 'unknown'> {
	try {
		const result = execSync('bash -l -c "module --version 2>&1"', {
			encoding: 'utf8',
			timeout: 5000
		});
		if (result.toLowerCase().includes('lmod')) {
			return 'lmod';
		}
		if (result.includes('Modules') || result.includes('modules')) {
			return 'environment-modules';
		}
	} catch {
		// Ignore errors
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

	try {
		const initScript = systemInfo.initPath;
		const command = 'module --version 2>&1';
		const fullCommand = initScript
			? `bash -l -c 'source "${initScript}" && ${command}'`
			: `bash -l -c '${command}'`;

		const result = execSync(fullCommand, {
			encoding: 'utf8',
			timeout: 5000,
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
	} catch {
		return undefined;
	}
}

/**
 * Build a shell command that initializes the module system and loads modules.
 *
 * @param modules Array of module names to load
 * @param initScript Optional path to init script
 * @returns Shell command string
 */
export function buildModuleLoadCommand(
	modules: string[],
	initScript?: string
): string {
	const parts: string[] = [];

	// Add init script sourcing if needed
	if (initScript) {
		parts.push(`source "${initScript}"`);
	}

	// Add module load commands
	for (const mod of modules) {
		parts.push(`module load ${mod}`);
	}

	return parts.join(' && ');
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
	const loadCommand = buildModuleLoadCommand(modules, initScript);
	// Use double quotes around the full command and escape single quotes in the command
	const escapedCommand = command.replace(/'/g, "'\\''");
	const fullCommand = loadCommand
		? `bash -l -c '${loadCommand} && ${escapedCommand}'`
		: `bash -l -c '${escapedCommand}'`;

	return new Promise((resolve, reject) => {
		logger.debug(`Executing: ${fullCommand}`);
		exec(fullCommand, {
			encoding: 'utf8',
			timeout: 30000
		}, (error, stdout, stderr) => {
			if (stdout) {
				logger.debug(stdout);
			}
			if (stderr) {
				logger.warn(stderr);
			}
			if (error) {
				reject(new Error(`Module command failed: ${stderr || error.message}`));
			} else {
				resolve(stdout.trim());
			}
		});
	});
}
