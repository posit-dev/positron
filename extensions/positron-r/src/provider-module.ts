/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { RBinary, registerModuleRuntimeWithApi } from './provider.js';
import { ReasonDiscovered, ModuleMetadata } from './r-installation.js';
import { LOGGER } from './extension.js';

/**
 * API interface for the environment-modules extension.
 * We define this locally to avoid a hard dependency.
 */
interface ModuleEnvironmentConfig {
	languages: string[];
	modules: string[];
}

interface ModuleResolvedInterpreter {
	environmentName: string;
	interpreterPath: string;
	version: string;
	modules: string[];
	startupCommand: string;
}

interface ResolveInterpreterOptions {
	environmentName: string;
	language: string;
	interpreterBinaryNames: string[];
	versionArgs: string[];
	parseVersion: (output: string) => string | undefined;
	throwOnError?: boolean;
}

/**
 * A single environment variable contributed by loading modules, as an action
 * to apply to a terminal's environment. Mirrors the type exported by the
 * positron-environment-modules extension; defined locally to avoid a hard
 * dependency.
 */
export interface CapturedEnvironmentVariable {
	name: string;
	value: string;
	action: 'replace' | 'prepend' | 'append';
}

export interface EnvironmentModulesApi {
	isAvailable(): Promise<boolean>;
	getEnvironmentsForLanguage(language: string): Promise<Map<string, ModuleEnvironmentConfig>>;
	resolveInterpreter(options: ResolveInterpreterOptions): Promise<ModuleResolvedInterpreter | undefined>;
	resolveInterpreterFromModules(
		modules: string[],
		options: Omit<ResolveInterpreterOptions, 'environmentName'> & { environmentName?: string }
	): Promise<ModuleResolvedInterpreter | undefined>;
	buildStartupCommand(modules: string[]): string;
	captureEnvironmentVariables(modules: string[]): Promise<CapturedEnvironmentVariable[]>;
	registerDiscoveredRuntime(
		environmentName: string,
		language: string,
		interpreterPath: string
	): void;
}

/**
 * Get the Environment Modules API if available.
 */
export async function getEnvironmentModulesApi(): Promise<EnvironmentModulesApi | undefined> {
	const ext = vscode.extensions.getExtension<EnvironmentModulesApi>(
		'positron.positron-environment-modules'
	);
	if (!ext) {
		LOGGER.debug('positron-environment-modules extension not found');
		return undefined;
	}
	try {
		return await ext.activate();
	} catch (error) {
		LOGGER.warn(`Failed to activate positron-environment-modules: ${error}`);
		return undefined;
	}
}

/**
 * Parse R version from `R --version` output.
 * Example output: "R version 4.3.0 (2023-04-21) -- "Already Tomorrow""
 */
export function parseRVersion(output: string): string | undefined {
	const match = output.match(/R version (\d+\.\d+\.\d+)/);
	return match ? match[1] : undefined;
}

/**
 * Whether module discovery could find R on this machine: environment modules
 * are on, and an environment in `positron.environmentModules.environments`
 * lists R. Reads settings only, so it never starts a shell.
 */
export function moduleEnvironmentsConfiguredForR(): boolean {
	// Module systems are only supported on Linux
	if (process.platform === 'win32' || process.platform === 'darwin') {
		return false;
	}
	const config = vscode.workspace.getConfiguration('positron.environmentModules');
	if (!config.get<boolean>('enabled', true)) {
		return false;
	}
	const environments = config.get<Record<string, { languages?: string[] }>>('environments', {});
	return Object.values(environments).some(env => env.languages?.includes('r'));
}

/** How the environment-modules extension finds R and its version. */
const R_RESOLVE_OPTIONS = {
	language: 'r',
	// R binary name - just 'R' on Unix systems
	interpreterBinaryNames: ['R'],
	versionArgs: ['--version'],
	parseVersion: parseRVersion,
};

/**
 * The environment-modules API, if module systems are supported and available here.
 */
async function availableModulesApi(): Promise<EnvironmentModulesApi | undefined> {
	// Module systems are only supported on Linux
	if (process.platform === 'win32' || process.platform === 'darwin') {
		return undefined;
	}
	const api = await getEnvironmentModulesApi();
	if (!api) {
		return undefined;
	}
	if (!await api.isAvailable()) {
		LOGGER.debug('Environment modules not available on this system');
		return undefined;
	}
	return api;
}

function moduleBinary(resolved: ModuleResolvedInterpreter): RBinary {
	const moduleMetadata: ModuleMetadata = {
		type: 'module',
		environmentName: resolved.environmentName,
		modules: resolved.modules,
		startupCommand: resolved.startupCommand
	};
	return {
		path: resolved.interpreterPath,
		reasons: [ReasonDiscovered.MODULE],
		packagerMetadata: moduleMetadata
	};
}

/** Characters allowed in a module name, which is passed to `module load` in a shell. */
const MODULE_NAME_PATTERN = /^[\w.+\-/@:]+$/;

/**
 * Resolves the R that a module name provides. The name is an R environment in
 * `positron.environmentModules.environments`, or else a module to load.
 * Loads only that environment or module, so it doesn't search.
 *
 * @throws An error describing why the module doesn't provide R, including the
 *   output of the failed module commands.
 */
export async function resolveModuleBinary(name: string): Promise<RBinary> {
	const api = await availableModulesApi();
	if (!api) {
		throw new Error('environment modules are not available');
	}
	const options = { environmentName: name, ...R_RESOLVE_OPTIONS, throwOnError: true };
	let resolved: ModuleResolvedInterpreter | undefined;
	const environments = await api.getEnvironmentsForLanguage('r');
	if (environments.has(name)) {
		resolved = await api.resolveInterpreter(options);
	} else if (MODULE_NAME_PATTERN.test(name)) {
		resolved = await api.resolveInterpreterFromModules([name], options);
	} else {
		throw new Error('module names may only contain letters, digits, and . _ + - / @ :');
	}
	if (!resolved) {
		throw new Error('R was not found');
	}
	LOGGER.info(`Found R at ${resolved.interpreterPath} from module "${name}"`);
	return moduleBinary(resolved);
}

/**
 * Discover R binaries from module environments.
 */
export async function discoverModuleBinaries(): Promise<RBinary[]> {
	const api = await availableModulesApi();
	if (!api) {
		return [];
	}

	const binaries: RBinary[] = [];
	const environments = await api.getEnvironmentsForLanguage('r');

	for (const [envName, _config] of environments) {
		LOGGER.info(`Discovering R from module environment: ${envName}`);

		const resolved = await api.resolveInterpreter({ environmentName: envName, ...R_RESOLVE_OPTIONS });

		if (resolved) {
			binaries.push(moduleBinary(resolved));
			LOGGER.info(`Found R at ${resolved.interpreterPath} from module environment "${envName}"`);
			registerModuleRuntimeWithApi(
				envName,
				resolved.interpreterPath
			);
		} else {
			LOGGER.warn(`Failed to resolve R from module environment "${envName}"`);
		}
	}

	return binaries;
}
