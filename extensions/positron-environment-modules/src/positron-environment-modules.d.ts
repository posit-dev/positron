/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TypeScript declarations for the positron-environment-modules extension API.
 *
 * Other extensions can use these types when consuming the API via:
 * const ext = vscode.extensions.getExtension<EnvironmentModulesApi>('positron.positron-environment-modules');
 */

import * as vscode from 'vscode';

/**
 * Configuration for a single module environment
 */
export interface ModuleEnvironmentConfig {
	/** Target languages that should discover this environment */
	languages: string[];
	/** List of modules to load, in order */
	modules: string[];
}

/**
 * Result of resolving an interpreter from a module environment.
 */
export interface ModuleResolvedInterpreter {
	/** The environment name from settings */
	environmentName: string;
	/** Path to the interpreter binary */
	interpreterPath: string;
	/** Version string of the interpreter */
	version: string;
	/** The modules that need to be loaded */
	modules: string[];
	/** The startup command to load all modules */
	startupCommand: string;
}

/**
 * Metadata stored in extraRuntimeData for module-discovered runtimes.
 */
export interface ModuleMetadata {
	/** Identifies this as a module environment */
	type: 'module';
	/** The environment name from settings */
	environmentName: string;
	/** The modules to load */
	modules: string[];
	/** Pre-computed startup command */
	startupCommand: string;
}

/**
 * Information about the module system on this machine
 */
export interface ModuleSystemInfo {
	/** Whether a module system was detected */
	available: boolean;
	/** The type of module system (lmod, environment-modules, or unknown) */
	type: 'lmod' | 'environment-modules' | 'unknown';
	/** Path to the module command or init script */
	initPath?: string;
	/** The command to use (typically 'module') */
	command: string;
}

/**
 * Options for resolving an interpreter from a module environment.
 */
export interface ResolveInterpreterOptions {
	/** The name of the environment from settings */
	environmentName: string;
	/** The target language identifier (e.g., 'r', 'python') */
	language: string;
	/** List of binary names to search for (e.g., ['R'] or ['python3', 'python']) */
	interpreterBinaryNames: string[];
	/** Command arguments to get the version (e.g., '--version') */
	versionArgs: string[];
	/**
	 * Function to parse version from the interpreter's output.
	 */
	parseVersion: (output: string) => string | undefined;
}

/**
 * Public API exposed by the positron-environment-modules extension.
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
	 */
	getEnvironmentsForLanguage(language: string): Promise<Map<string, ModuleEnvironmentConfig>>;

	/**
	 * Resolve an interpreter path and version for a module environment.
	 */
	resolveInterpreter(
		options: ResolveInterpreterOptions
	): Promise<ModuleResolvedInterpreter | undefined>;

	/**
	 * Build the startup command string for loading modules.
	 */
	buildStartupCommand(modules: string[]): string;

	/**
	 * Event fired when the module environments configuration changes.
	 */
	onDidChangeConfiguration: vscode.Event<void>;
}
