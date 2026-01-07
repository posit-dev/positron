/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
	ModuleEnvironmentConfig,
	ModuleResolvedInterpreter,
	ModuleSystemInfo,
	ResolveInterpreterOptions
} from './types.js';

/**
 * Public API exposed by the positron-environment-modules extension.
 *
 * This API is used by language extensions (positron-r, positron-python, etc.)
 * to discover interpreters provided by module environments.
 *
 * The API is intentionally language-agnostic - language-specific details
 * (binary names, version parsing) are provided by the calling extension.
 */
export interface EnvironmentModulesApi {
	/**
	 * Check if environment modules support is enabled and available.
	 */
	isAvailable(): Promise<boolean>;

	/**
	 * Get information about the module system on this machine.
	 */
	getModuleSystemInfo(): Promise<ModuleSystemInfo>;

	/**
	 * Get all configured environments that target a specific language.
	 *
	 * @param language The language to filter by (e.g., 'r', 'python', 'julia')
	 * @returns Map of environment names to their configurations
	 */
	getEnvironmentsForLanguage(language: string): Promise<Map<string, ModuleEnvironmentConfig>>;

	/**
	 * Resolve an interpreter path and version for a module environment.
	 *
	 * This loads the specified modules in a shell and determines:
	 * - The path to the interpreter binary
	 * - The interpreter version
	 * - The startup command for kernel launch
	 *
	 * Language-specific details are provided via the options parameter,
	 * keeping this extension language-agnostic.
	 *
	 * @param options Options specifying how to find and parse the interpreter
	 * @returns Resolved interpreter info, or undefined if resolution failed
	 */
	resolveInterpreter(
		options: ResolveInterpreterOptions
	): Promise<ModuleResolvedInterpreter | undefined>;

	/**
	 * Build the startup command string for loading modules.
	 *
	 * @param modules Array of module names to load
	 * @returns Shell command string (e.g., "source /etc/profile.d/modules.sh && module load R/4.3.0")
	 */
	buildStartupCommand(modules: string[]): string;

	/**
	 * Event fired when the module environments configuration changes.
	 */
	onDidChangeConfiguration: vscode.Event<void>;
}
