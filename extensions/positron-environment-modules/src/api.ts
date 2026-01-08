/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
	DiscoveredRuntimeInfo,
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

	/**
	 * Register a runtime that was discovered in a module environment.
	 * Called by language extensions (positron-r, positron-python) after discovering a runtime.
	 *
	 * @param environmentName The name of the module environment
	 * @param runtimeId The Positron runtime ID
	 * @param language The language identifier
	 * @param interpreterPath The path to the interpreter
	 */
	registerDiscoveredRuntime(
		environmentName: string,
		runtimeId: string,
		language: string,
		interpreterPath: string
	): void;

	/**
	 * Get all runtimes discovered in a specific environment.
	 *
	 * @param environmentName The name of the module environment
	 * @returns Array of discovered runtime info, or empty array if none
	 */
	getDiscoveredRuntimes(environmentName: string): DiscoveredRuntimeInfo[];

	/**
	 * Get all environments and their discovered runtimes.
	 *
	 * @returns Map of environment names to their discovered runtimes
	 */
	getAllDiscoveredRuntimes(): Map<string, DiscoveredRuntimeInfo[]>;
}
