/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PythonEnvKind, PythonEnvSource } from '../../info';
import { BasicEnvInfo, IPythonEnvsIterator, Locator } from '../../locator';
import { traceInfo, traceWarn } from '../../../../logging';

/**
 * Module metadata stored with the environment
 */
export interface ModuleMetadata {
	type: 'module';
	environmentName: string;
	modules: string[];
	startupCommand: string;
	version: string;
}

/**
 * API interface for the environment-modules extension
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
 * Get the Environment Modules API if available.
 */
export async function getEnvironmentModulesApi(): Promise<EnvironmentModulesApi | undefined> {
	const ext = vscode.extensions.getExtension<EnvironmentModulesApi>(
		'positron.positron-environment-modules',
	);
	if (!ext) {
		traceInfo('[ModuleEnvironmentLocator] positron-environment-modules extension not found');
		return undefined;
	}
	try {
		return await ext.activate();
	} catch (error) {
		traceWarn(`[ModuleEnvironmentLocator] Failed to activate positron-environment-modules: ${error}`);
		return undefined;
	}
}

/**
 * Parse Python version from `python --version` output.
 * Example output: "Python 3.11.3"
 */
function parsePythonVersion(output: string): string | undefined {
	const match = output.match(/Python (\d+\.\d+\.\d+)/);
	return match ? match[1] : undefined;
}

/**
 * Map from executable path to module metadata for module-discovered environments.
 * This is used to store metadata that can be retrieved later when creating the runtime.
 */
export const moduleMetadataMap = new Map<string, ModuleMetadata>();

/**
 * Map from interpreter path to pending module runtime registration info.
 * This is used to track which environments need to be registered when runtimes are discovered.
 */
export const pendingModuleRuntimeRegistrations = new Map<string, {
	environmentName: string;
	interpreterPath: string;
}>();

/**
 * Locator for Python environments provided by environment modules.
 */
export class ModuleEnvironmentLocator extends Locator<BasicEnvInfo> {
	public readonly providerId: string = 'module-envs';

	public iterEnvs(): IPythonEnvsIterator<BasicEnvInfo> {
		const iterator = this.doIterEnvs();
		return iterator;
	}

	private async *doIterEnvs(): IPythonEnvsIterator<BasicEnvInfo> {
		// Module systems are only available on Unix-like systems
		if (process.platform === 'win32') {
			return;
		}

		const api = await getEnvironmentModulesApi();
		if (!api) {
			return;
		}

		const available = await api.isAvailable();
		if (!available) {
			traceInfo('[ModuleEnvironmentLocator] Environment modules not available on this system');
			return;
		}

		const environments = await api.getEnvironmentsForLanguage('python');

		for (const [envName, _config] of environments) {
			traceInfo(`[ModuleEnvironmentLocator] Discovering Python from module environment: ${envName}`);

			const resolved = await api.resolveInterpreter({
				environmentName: envName,
				language: 'python',
				// Python binary names to search for
				interpreterBinaryNames: ['python3', 'python'],
				// Arguments to get version
				versionArgs: ['--version'],
				// Python-specific version parser
				parseVersion: parsePythonVersion,
			});

			if (resolved) {
				traceInfo(
					`[ModuleEnvironmentLocator] Found Python at ${resolved.interpreterPath} from module environment "${envName}"`,
				);

				// Store the module metadata for later retrieval
				const metadata: ModuleMetadata = {
					type: 'module',
					environmentName: resolved.environmentName,
					modules: resolved.modules,
					startupCommand: resolved.startupCommand,
					version: resolved.version,
				};
				moduleMetadataMap.set(resolved.interpreterPath, metadata);

				// Store pending registration for when runtime is registered with Positron
				pendingModuleRuntimeRegistrations.set(resolved.interpreterPath, {
					environmentName: resolved.environmentName,
					interpreterPath: resolved.interpreterPath,
				});

				yield {
					kind: PythonEnvKind.Module, // Using Module kind for module environments
					executablePath: resolved.interpreterPath,
					source: [PythonEnvSource.UserSettings], // Mark as user-configured
					envPath: undefined,
					searchLocation: undefined,
				};
			} else {
				traceWarn(`[ModuleEnvironmentLocator] Failed to resolve Python from module environment "${envName}"`);
			}
		}
	}
}
