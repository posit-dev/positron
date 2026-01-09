/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { RBinary } from './provider.js';
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
}

export interface EnvironmentModulesApi {
	isAvailable(): Promise<boolean>;
	getEnvironmentsForLanguage(language: string): Promise<Map<string, ModuleEnvironmentConfig>>;
	resolveInterpreter(options: ResolveInterpreterOptions): Promise<ModuleResolvedInterpreter | undefined>;
	registerDiscoveredRuntime(
		environmentName: string,
		runtimeId: string,
		language: string,
		interpreterPath: string
	): void;
}

/**
 * Map from interpreter path to pending module runtime registration info.
 * This is used to track which environments need to be registered when runtimes are discovered.
 */
export const pendingModuleRuntimeRegistrations = new Map<string, {
	environmentName: string;
	interpreterPath: string;
}>();

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
function parseRVersion(output: string): string | undefined {
	const match = output.match(/R version (\d+\.\d+\.\d+)/);
	return match ? match[1] : undefined;
}

/**
 * Discover R binaries from module environments.
 */
export async function discoverModuleBinaries(): Promise<RBinary[]> {
	// Module systems are only available on Unix-like systems
	if (process.platform === 'win32') {
		return [];
	}

	const api = await getEnvironmentModulesApi();
	if (!api) {
		return [];
	}

	const available = await api.isAvailable();
	if (!available) {
		LOGGER.debug('Environment modules not available on this system');
		return [];
	}

	const binaries: RBinary[] = [];
	const environments = await api.getEnvironmentsForLanguage('r');

	for (const [envName, _config] of environments) {
		LOGGER.info(`Discovering R from module environment: ${envName}`);

		const resolved = await api.resolveInterpreter({
			environmentName: envName,
			language: 'r',
			// R binary name - just 'R' on Unix systems
			interpreterBinaryNames: ['R'],
			// Arguments to get version
			versionArgs: ['--version'],
			// R-specific version parser
			parseVersion: parseRVersion
		});

		if (resolved) {
			const moduleMetadata: ModuleMetadata = {
				type: 'module',
				environmentName: resolved.environmentName,
				modules: resolved.modules,
				startupCommand: resolved.startupCommand
			};

			// Normalize the interpreter path to match how RInstallation normalizes it
			const normalizedPath = path.normalize(resolved.interpreterPath);

			// Store pending registration for when runtime is registered with Positron
			pendingModuleRuntimeRegistrations.set(normalizedPath, {
				environmentName: resolved.environmentName,
				interpreterPath: normalizedPath
			});

			binaries.push({
				path: resolved.interpreterPath,
				reasons: [ReasonDiscovered.MODULE],
				packagerMetadata: moduleMetadata
			});
			LOGGER.info(`Found R at ${resolved.interpreterPath} from module environment "${envName}"`);
		} else {
			LOGGER.warn(`Failed to resolve R from module environment "${envName}"`);
		}
	}

	return binaries;
}
