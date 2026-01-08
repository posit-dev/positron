/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { execSync } from 'child_process';
import { ModuleSystemInfo } from './types.js';
import { getLog } from './logger.js';

/**
 * List available modules from the module system.
 *
 * For Lmod: Uses `module -t avail` for terse output
 * For Environment Modules: Uses `module avail -t` for terse output
 *
 * @param moduleSystemInfo Information about the detected module system
 * @returns Array of available module names
 */
export async function listAvailableModules(
	moduleSystemInfo: ModuleSystemInfo
): Promise<string[]> {
	const logger = getLog();

	if (!moduleSystemInfo.available) {
		return [];
	}

	// Both Lmod and Environment Modules support terse output with -t flag
	// Lmod: module -t avail (outputs one module per line)
	// Environment Modules: module avail -t (outputs one module per line)
	// Note: module avail writes to stderr in both systems
	const command = moduleSystemInfo.type === 'lmod'
		? 'module -t avail 2>&1'
		: 'module avail -t 2>&1';

	// Execute in login shell with module system initialized
	const initScript = moduleSystemInfo.initPath;
	const fullCommand = initScript
		? `bash -l -c 'source "${initScript}" && ${command}'`
		: `bash -l -c '${command}'`;

	try {
		logger.debug(`Listing modules with: ${fullCommand}`);
		const output = execSync(fullCommand, {
			encoding: 'utf8',
			timeout: 30000,
			stdio: ['pipe', 'pipe', 'pipe']
		});

		// Parse the output - one module per line
		// Filter out empty lines and directory headers (lines ending with :)
		const modules = output
			.split('\n')
			.map(line => line.trim())
			.filter(line => line.length > 0 && !line.endsWith(':'));

		logger.info(`Found ${modules.length} available modules`);
		return modules;
	} catch (error) {
		logger.warn(`Failed to list available modules: ${error}`);
		return [];
	}
}
