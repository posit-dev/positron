/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { EnvironmentModulesApi } from './api.js';
import {
	ModuleEnvironmentConfig,
	ModuleResolvedInterpreter,
	ModuleSystemInfo,
	ResolveInterpreterOptions
} from './types.js';
import { detectModuleSystem, buildModuleLoadCommand } from './module-system.js';
import { resolveModuleInterpreter } from './environment-resolver.js';

export const log = vscode.window.createOutputChannel('Environment Modules', { log: true });

class EnvironmentModulesApiImpl implements EnvironmentModulesApi {
	private _onDidChangeConfiguration = new vscode.EventEmitter<void>();
	readonly onDidChangeConfiguration = this._onDidChangeConfiguration.event;

	private _moduleSystemInfo: ModuleSystemInfo | undefined;
	private _resolverCache = new Map<string, ModuleResolvedInterpreter>();

	constructor(private readonly context: vscode.ExtensionContext) {
		// Watch for configuration changes
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('positron.environmentModules')) {
					this._resolverCache.clear();
					this._moduleSystemInfo = undefined;
					this._onDidChangeConfiguration.fire();
				}
			})
		);
	}

	/**
	 * Check if environment modules support is enabled and available.
	 *
	 * @returns A promise that resolves to true if environment modules are enabled and available, false otherwise.
	 */
	async isAvailable(): Promise<boolean> {
		const config = vscode.workspace.getConfiguration('positron.environmentModules');
		if (!config.get<boolean>('enabled', true)) {
			return false;
		}

		const systemInfo = await this.getModuleSystemInfo();
		return systemInfo.available;
	}

	/**
	 * Get information about the module system on this machine.
	 *
	 * @returns  A promise that resolves to module system information.
	 */
	async getModuleSystemInfo(): Promise<ModuleSystemInfo> {
		if (!this._moduleSystemInfo) {
			const config = vscode.workspace.getConfiguration('positron.environmentModules');
			const customInitScript = config.get<string>('initScript');
			this._moduleSystemInfo = await detectModuleSystem(customInitScript || undefined);
			log.info(`Module system detected: ${JSON.stringify(this._moduleSystemInfo)}`);
		}
		return this._moduleSystemInfo;
	}

	/**
	 * Get all configured environments that target a specific language.
	 *
	 * @param language The language to filter by (e.g., 'r', 'python', 'julia')
	 * @returns Map of environment names to their configurations
	 */
	async getEnvironmentsForLanguage(language: string): Promise<Map<string, ModuleEnvironmentConfig>> {
		const config = vscode.workspace.getConfiguration('positron.environmentModules');
		const environments = config.get<Record<string, ModuleEnvironmentConfig>>('environments', {});

		const result = new Map<string, ModuleEnvironmentConfig>();
		for (const [name, envConfig] of Object.entries(environments)) {
			if (envConfig.languages.includes(language)) {
				result.set(name, envConfig);
			}
		}
		return result;
	}

	/**
	 * Resolve an interpreter path and version for a module environment.
	 *
	 * @param options Options specifying how to find and parse the interpreter
	 * @returns The resolved interpreter info, or undefined if resolution failed.
	 */
	async resolveInterpreter(
		options: ResolveInterpreterOptions
	): Promise<ModuleResolvedInterpreter | undefined> {
		// Check cache first
		const cacheKey = `${options.environmentName}:${options.language}`;
		if (this._resolverCache.has(cacheKey)) {
			return this._resolverCache.get(cacheKey);
		}

		// Get the environment configuration
		const environments = await this.getEnvironmentsForLanguage(options.language);
		const envConfig = environments.get(options.environmentName);
		if (!envConfig) {
			log.warn(`Environment "${options.environmentName}" not found for language "${options.language}"`);
			return undefined;
		}

		// Get init script path
		const systemInfo = await this.getModuleSystemInfo();
		const initScript = systemInfo.initPath;

		// Resolve the interpreter
		const resolved = await resolveModuleInterpreter(
			envConfig,
			options,
			initScript
		);

		if (resolved) {
			this._resolverCache.set(cacheKey, resolved);
		}
		return resolved;
	}

	/**
	 * Build the startup command string for loading modules.
	 * @param modules Array of module names to load
	 * @returns Shell command string
	 */
	buildStartupCommand(modules: string[]): string {
		const initScript = this._moduleSystemInfo?.initPath;
		return buildModuleLoadCommand(modules, initScript);
	}
}

/**
 * Main activation function for the extension.
 *
 * @param context The extension context
 * @returns The public API for the extension
 */
export async function activate(
	context: vscode.ExtensionContext
): Promise<EnvironmentModulesApi> {
	context.subscriptions.push(log);
	log.info('Activating positron-environment-modules extension');

	const api = new EnvironmentModulesApiImpl(context);

	// Register commands
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positron.environmentModules.refreshEnvironments',
			async () => {
				// Clear cache and re-detect
				// Access private fields through type assertion for refresh
				(api as unknown as { _moduleSystemInfo: ModuleSystemInfo | undefined })._moduleSystemInfo = undefined;
				(api as unknown as { _resolverCache: Map<string, ModuleResolvedInterpreter> })._resolverCache.clear();
				const info = await api.getModuleSystemInfo();
				if (info.available) {
					vscode.window.showInformationMessage(
						`Module system detected: ${info.type}`
					);
				} else {
					vscode.window.showWarningMessage(
						'No module system detected on this machine'
					);
				}
			}
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positron.environmentModules.listAvailableModules',
			async () => {
				const info = await api.getModuleSystemInfo();
				if (!info.available) {
					vscode.window.showErrorMessage('No module system available');
					return;
				}

				// This would open a QuickPick with available modules
				// Implementation details depend on module system type
				vscode.window.showInformationMessage(
					'Module listing not yet implemented'
				);
			}
		)
	);

	return api;
}

export function deactivate() {
	log.info('Deactivating positron-environment-modules extension');
}
