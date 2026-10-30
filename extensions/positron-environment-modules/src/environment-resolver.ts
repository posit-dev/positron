/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ModuleEnvironmentConfig, ModuleResolvedInterpreter, ResolveInterpreterOptions } from './types.js';
import { executeWithModules, buildModuleLoadCommand } from './module-system.js';
import { log } from './logger.js';


/**
 * Resolve an interpreter from a module environment configuration.
 *
 * This function is language-agnostic - it accepts options that specify
 * how to find the interpreter binary and parse its version.
 *
 * @param config The module environment configuration
 * @param options Options specifying how to find and parse the interpreter
 * @param initScript Optional path to the module init script
 * @param purge Whether to run `module purge` before loading the modules. This
 *   applies to discovery and to the returned startup command, so the
 *   discovered interpreter matches the one the kernel runs.
 */
export async function resolveModuleInterpreter(
	config: ModuleEnvironmentConfig,
	options: ResolveInterpreterOptions,
	initScript?: string,
	purge?: boolean
): Promise<ModuleResolvedInterpreter | undefined> {
	try {
		// Build a command to find the interpreter using 'which'
		// Try each binary name in order until one is found
		let interpreterPath: string | undefined;
		const errorMessages: string[] = [];

		for (const binaryName of options.interpreterBinaryNames) {
			try {
				const whichResult = await executeWithModules(
					config.modules,
					`which ${binaryName}`,
					initScript,
					purge
				);
				if (whichResult && whichResult.length > 0) {
					interpreterPath = whichResult;
					break;
				}
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				errorMessages.push(`which ${binaryName}: ${errorMsg}`);
			}
		}

		if (!interpreterPath) {
			log.warn(`Could not find interpreter for environment "${options.environmentName}" using binaries: ${options.interpreterBinaryNames.join(', ')}`);
			for (const msg of errorMessages) {
				log.warn(msg);
			}
			if (options.throwOnError) {
				throw new Error(errorMessages.join('\n') ||
					`None of ${options.interpreterBinaryNames.join(', ')} found after loading ${config.modules.join(', ')}`);
			}
			return undefined;
		}

		// Get the version using the provided version args
		const versionCommand = `${interpreterPath} ${options.versionArgs.join(' ')} 2>&1`;
		let versionOutput: string;
		try {
			versionOutput = await executeWithModules(
				config.modules,
				versionCommand,
				initScript,
				purge
			);
		} catch (error) {
			log.warn(`Failed to get version for interpreter at ${interpreterPath}: ${error}`);
			versionOutput = '';
		}

		// Parse the version using the provided parser
		const version = options.parseVersion(versionOutput) || 'unknown';

		// Build the startup command
		const startupCommand = buildModuleLoadCommand(config.modules, initScript, undefined, purge);

		log.info(`Resolved interpreter from module environment "${options.environmentName}": ${interpreterPath} (${version})`);

		return {
			environmentName: options.environmentName,
			interpreterPath,
			version,
			modules: config.modules,
			startupCommand
		};
	} catch (error) {
		log.error(`Failed to resolve interpreter for environment "${options.environmentName}": ${error}`);
		if (options.throwOnError) {
			throw error;
		}
		return undefined;
	}
}
