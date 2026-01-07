/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ModuleEnvironmentConfig, ModuleResolvedInterpreter, ResolveInterpreterOptions } from './types.js';
import { executeWithModules, buildModuleLoadCommand } from './module-system.js';
import { getLog } from './logger.js';


/**
 * Resolve an interpreter from a module environment configuration.
 *
 * This function is language-agnostic - it accepts options that specify
 * how to find the interpreter binary and parse its version.
 */
export async function resolveModuleInterpreter(
	config: ModuleEnvironmentConfig,
	options: ResolveInterpreterOptions,
	initScript?: string
): Promise<ModuleResolvedInterpreter | undefined> {
	const logger = getLog();

	try {
		// Build a command to find the interpreter using 'which'
		// Try each binary name in order until one is found
		let interpreterPath: string | undefined;

		for (const binaryName of options.interpreterBinaryNames) {
			try {
				const whichResult = await executeWithModules(
					config.modules,
					`which ${binaryName}`,
					initScript
				);
				if (whichResult && whichResult.length > 0) {
					interpreterPath = whichResult;
					break;
				}
			} catch {
				// Try next binary name
			}
		}

		if (!interpreterPath) {
			logger.warn(`Could not find interpreter for environment "${options.environmentName}" using binaries: ${options.interpreterBinaryNames.join(', ')}`);
			return undefined;
		}

		// Get the version using the provided version args
		const versionCommand = `${interpreterPath} ${options.versionArgs.join(' ')} 2>&1`;
		let versionOutput: string;
		try {
			versionOutput = await executeWithModules(
				config.modules,
				versionCommand,
				initScript
			);
		} catch (error) {
			logger.warn(`Failed to get version for interpreter at ${interpreterPath}: ${error}`);
			versionOutput = '';
		}

		// Parse the version using the provided parser
		const version = options.parseVersion(versionOutput) || 'unknown';

		// Build the startup command
		const startupCommand = buildModuleLoadCommand(config.modules, initScript);

		logger.info(`Resolved interpreter from module environment "${options.environmentName}": ${interpreterPath} (${version})`);

		return {
			environmentName: options.environmentName,
			interpreterPath,
			version,
			modules: config.modules,
			startupCommand
		};
	} catch (error) {
		logger.error(`Failed to resolve interpreter for environment "${options.environmentName}": ${error}`);
		return undefined;
	}
}
