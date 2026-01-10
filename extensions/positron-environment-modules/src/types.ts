/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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
 * Map of environment names to their configurations
 */
export interface ModuleEnvironmentsConfig {
	[environmentName: string]: ModuleEnvironmentConfig;
}

/**
 * Result of resolving an interpreter from a module environment.
 * This is language-agnostic - consumers provide the binary names and version parsing.
 */
export interface ModuleResolvedInterpreter {
	/** The environment name from settings */
	environmentName: string;
	/** Path to the interpreter binary */
	interpreterPath: string;
	/** Version string of the interpreter (as parsed by the caller) */
	version: string;
	/** The modules that need to be loaded */
	modules: string[];
	/** The startup command to load all modules */
	startupCommand: string;
}

/**
 * Metadata stored in extraRuntimeData for module-discovered runtimes.
 * This interface can be used by any language extension.
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
 * Language extensions provide these to customize interpreter discovery.
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
	 * The function receives the full output and should return the version string.
	 */
	parseVersion: (output: string) => string | undefined;
}

/**
 * Information about a runtime discovered in a module environment
 */
export interface DiscoveredRuntimeInfo {
	/** The language (e.g., 'r', 'python') */
	language: string;
	/** The interpreter path */
	interpreterPath: string;
}
