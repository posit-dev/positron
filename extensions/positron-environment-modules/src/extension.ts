/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { EnvironmentModulesApi } from './api.js';
import {
	DiscoveredRuntimeInfo,
	ModuleEnvironmentConfig,
	ModuleResolvedInterpreter,
	ModuleSystemInfo,
	ResolveInterpreterOptions
} from './types.js';
import { detectModuleSystem, buildModuleLoadCommand, getModuleSystemVersion } from './module-system.js';
import { resolveModuleInterpreter } from './environment-resolver.js';
import { manageEnvironmentsCommand } from './manage-environments-command.js';
import { listAvailableModules } from './module-listing.js';

let _log: vscode.LogOutputChannel | undefined;
export const log = {
	get channel(): vscode.LogOutputChannel {
		if (!_log) {
			_log = vscode.window.createOutputChannel('Environment Modules', { log: true });
		}
		return _log;
	},
	info(message: string) {
		this.channel.info(message);
	},
	warn(message: string) {
		this.channel.warn(message);
	},
	error(message: string) {
		this.channel.error(message);
	}
};

class EnvironmentModulesApiImpl implements EnvironmentModulesApi {
	private _onDidChangeConfiguration = new vscode.EventEmitter<void>();
	readonly onDidChangeConfiguration = this._onDidChangeConfiguration.event;

	private _moduleSystemInfo: ModuleSystemInfo | undefined;
	private _resolverCache = new Map<string, ModuleResolvedInterpreter>();
	private _discoveredRuntimes = new Map<string, DiscoveredRuntimeInfo[]>();

	constructor(private readonly context: vscode.ExtensionContext) {
		// Watch for configuration changes
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('positron.environmentModules')) {
					this._resolverCache.clear();
					this._moduleSystemInfo = undefined;
					this._discoveredRuntimes.clear();
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

	/**
	 * Register a runtime that was discovered in a module environment.
	 */
	registerDiscoveredRuntime(
		environmentName: string,
		language: string,
		interpreterPath: string
	): void {
		const existing = this._discoveredRuntimes.get(environmentName) || [];
		existing.push({
			language,
			interpreterPath
		});
		this._discoveredRuntimes.set(environmentName, existing);
		log.info(`Registered runtime ${interpreterPath} for environment "${environmentName}"`);
	}

	/**
	 * Get all runtimes discovered in a specific environment.
	 */
	getDiscoveredRuntimes(environmentName: string): DiscoveredRuntimeInfo[] {
		return this._discoveredRuntimes.get(environmentName) || [];
	}

	/**
	 * Get all environments and their discovered runtimes.
	 */
	getAllDiscoveredRuntimes(): Map<string, DiscoveredRuntimeInfo[]> {
		return new Map(this._discoveredRuntimes);
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
	// Environment modules are only supported on Linux
	if (process.platform === 'win32' || process.platform === 'darwin') {
		// Return a stub API that reports as unavailable
		return {
			onDidChangeConfiguration: new vscode.EventEmitter<void>().event,
			async isAvailable() {
				return false;
			},
			async getModuleSystemInfo(): Promise<ModuleSystemInfo> {
				return {
					available: false,
					command: '',
					type: 'unknown'
				};
			},
			async getEnvironmentsForLanguage(): Promise<Map<string, ModuleEnvironmentConfig>> {
				return new Map();
			},
			async resolveInterpreter(): Promise<ModuleResolvedInterpreter | undefined> {
				return undefined;
			},
			buildStartupCommand() {
				return '';
			},
			registerDiscoveredRuntime() {
				// No-op on Windows
			},
			getDiscoveredRuntimes(): DiscoveredRuntimeInfo[] {
				return [];
			},
			getAllDiscoveredRuntimes(): Map<string, DiscoveredRuntimeInfo[]> {
				return new Map();
			}
		};
	}

	log.info('Activating positron-environment-modules extension');
	if (_log) {
		context.subscriptions.push(_log);
	}

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
			'positron.environmentModules.diagnosticsReport',
			async () => {
				const report = await generateDiagnosticsReport(api);
				const doc = await vscode.workspace.openTextDocument({
					content: report,
					language: 'markdown'
				});
				await vscode.window.showTextDocument(doc);
			}
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positron.environmentModules.manageEnvironments',
			() => manageEnvironmentsCommand(api)
		)
	);

	return api;
}

/**
 * Generate a diagnostic report about the environment modules system.
 */
async function generateDiagnosticsReport(api: EnvironmentModulesApiImpl): Promise<string> {
	const lines: string[] = [];

	lines.push('# Environment Modules Diagnostic Report');
	lines.push('');
	lines.push(`Generated: ${new Date().toISOString()}`);
	lines.push('');

	// Module System Detection
	lines.push('## Module System');
	lines.push('');

	const systemInfo = await api.getModuleSystemInfo();
	if (!systemInfo.available) {
		lines.push('**Status:** Not available');
		lines.push('');
		lines.push('No environment module system was detected on this machine.');
		lines.push('');
	} else {
		lines.push(`**Status:** Available`);
		lines.push(`**Type:** ${systemInfo.type}`);
		lines.push(`**Command:** ${systemInfo.command}`);
		if (systemInfo.initPath) {
			lines.push(`**Init Script:** ${systemInfo.initPath}`);
		}

		// Get version information
		const version = await getModuleSystemVersion(systemInfo);
		if (version) {
			lines.push(`**Version:** ${version}`);
		}
		lines.push('');
	}

	// Configuration Settings
	lines.push('## Configuration');
	lines.push('');
	const config = vscode.workspace.getConfiguration('positron.environmentModules');
	lines.push(`**Enabled:** ${config.get<boolean>('enabled', true)}`);
	const customInitScript = config.get<string>('initScript');
	if (customInitScript) {
		lines.push(`**Custom Init Script:** ${customInitScript}`);
	}
	lines.push('');

	// Configured Environments
	lines.push('## Configured Environments');
	lines.push('');

	const environments = config.get<Record<string, { languages: string[]; modules: string[] }>>('environments', {});
	const envNames = Object.keys(environments);

	if (envNames.length === 0) {
		lines.push('No environments configured.');
		lines.push('');
		lines.push('Use the "Manage Module Environments" command to configure environments.');
		lines.push('');
	} else {
		for (const envName of envNames) {
			const envConfig = environments[envName];
			lines.push(`### ${envName}`);
			lines.push('');
			lines.push(`**Languages:** ${envConfig.languages.join(', ')}`);
			lines.push(`**Modules:** ${envConfig.modules.join(', ')}`);
			lines.push('');

			// Show discovered interpreters for this environment
			const discoveredRuntimes = api.getDiscoveredRuntimes(envName);
			if (discoveredRuntimes.length > 0) {
				lines.push('**Discovered Interpreters:**');
				lines.push('');
				for (const runtime of discoveredRuntimes) {
					lines.push(`- ${runtime.language}: \`${runtime.interpreterPath}\``);
				}
				lines.push('');
			} else {
				lines.push('**Discovered Interpreters:** None discovered yet');
				lines.push('');
			}
		}
	}

	// Available Modules
	if (systemInfo.available) {
		lines.push('## Available Modules');
		lines.push('');

		try {
			const modules = await listAvailableModules(systemInfo);
			if (modules.length === 0) {
				lines.push('No modules found or unable to list modules.');
			} else {
				lines.push(`Found ${modules.length} available modules:`);
				lines.push('');
				lines.push('```');
				for (const mod of modules) {
					lines.push(mod);
				}
				lines.push('```');
			}
		} catch (error) {
			lines.push(`Error listing modules: ${error}`);
		}
		lines.push('');
	}

	return lines.join('\n');
}

export function deactivate() {
	if (_log) {
		log.info('Deactivating positron-environment-modules extension');
	}
}
