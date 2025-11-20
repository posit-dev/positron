/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DevContainerConfiguration, LogLevel } from './types';
import { getLogger } from './logger';

/**
 * Configuration service for dev containers extension
 * Reads settings from workspace configuration
 */
export class Configuration {
	private static instance: Configuration;
	private config: vscode.WorkspaceConfiguration;

	private constructor() {
		this.config = vscode.workspace.getConfiguration('dev.containers');
	}

	/**
	 * Get the singleton configuration instance
	 */
	static getInstance(): Configuration {
		if (!Configuration.instance) {
			Configuration.instance = new Configuration();
		}
		return Configuration.instance;
	}

	/**
	 * Reload configuration (useful when settings change)
	 */
	reload(): void {
		this.config = vscode.workspace.getConfiguration('dev.containers');
		getLogger().debug('Configuration reloaded');
	}

	/**
	 * Get all dev container configuration
	 */
	getConfiguration(): DevContainerConfiguration {
		return {
			enable: this.getEnable(),
			defaultExtensions: this.getDefaultExtensions(),
			defaultFeatures: this.getDefaultFeatures(),
			workspaceMountConsistency: this.getWorkspaceMountConsistency(),
			gpuAvailability: this.getGpuAvailability(),
			cacheVolume: this.getCacheVolume(),
			copyGitConfig: this.getCopyGitConfig(),
			gitCredentialHelperConfigLocation: this.getGitCredentialHelperConfigLocation(),
			dockerCredentialHelper: this.getDockerCredentialHelper(),
			githubCLILoginWithToken: this.getGithubCLILoginWithToken(),
			mountWaylandSocket: this.getMountWaylandSocket(),
			logLevel: this.getLogLevel(),
			dockerPath: this.getDockerPath(),
			dockerComposePath: this.getDockerComposePath(),
			dockerSocketPath: this.getDockerSocketPath(),
			executeInWSL: this.getExecuteInWSL(),
			executeInWSLDistro: this.getExecuteInWSLDistro(),
			forwardWSLServices: this.getForwardWSLServices(),
			repositoryConfigurationPaths: this.getRepositoryConfigurationPaths(),
			optimisticallyLaunchDocker: this.getOptimisticallyLaunchDocker()
		};
	}

	/**
	 * Get enable setting
	 */
	getEnable(): boolean {
		return this.config.get<boolean>('enable', false);
	}

	/**
	 * Get default extensions to install in containers
	 */
	getDefaultExtensions(): string[] {
		return this.config.get<string[]>('defaultExtensions', []);
	}

	/**
	 * Get default features to include in containers
	 */
	getDefaultFeatures(): Record<string, any> {
		return this.config.get<Record<string, any>>('defaultFeatures', {});
	}

	/**
	 * Get workspace mount consistency setting
	 */
	getWorkspaceMountConsistency(): 'consistent' | 'cached' | 'delegated' {
		return this.config.get<'consistent' | 'cached' | 'delegated'>('workspaceMountConsistency', 'cached');
	}

	/**
	 * Get GPU availability setting
	 */
	getGpuAvailability(): 'all' | 'detect' | 'none' {
		return this.config.get<'all' | 'detect' | 'none'>('gpuAvailability', 'detect');
	}

	/**
	 * Get cache volume setting
	 */
	getCacheVolume(): boolean {
		return this.config.get<boolean>('cacheVolume', true);
	}

	/**
	 * Get copy git config setting
	 */
	getCopyGitConfig(): boolean {
		return this.config.get<boolean>('copyGitConfig', true);
	}

	/**
	 * Get git credential helper config location
	 */
	getGitCredentialHelperConfigLocation(): 'system' | 'global' | 'none' {
		return this.config.get<'system' | 'global' | 'none'>('gitCredentialHelperConfigLocation', 'global');
	}

	/**
	 * Get docker credential helper setting
	 */
	getDockerCredentialHelper(): boolean {
		return this.config.get<boolean>('dockerCredentialHelper', true);
	}

	/**
	 * Get GitHub CLI login with token setting
	 */
	getGithubCLILoginWithToken(): boolean {
		return this.config.get<boolean>('githubCLILoginWithToken', false);
	}

	/**
	 * Get mount Wayland socket setting
	 */
	getMountWaylandSocket(): boolean {
		return this.config.get<boolean>('mountWaylandSocket', true);
	}

	/**
	 * Get log level
	 */
	getLogLevel(): LogLevel {
		const level = this.config.get<string>('logLevel', 'debug');
		return level as LogLevel;
	}

	/**
	 * Get Docker path, resolving to absolute path if necessary
	 */
	getDockerPath(): string {
		const configuredPath = this.config.get<string>('dockerPath', 'docker');

		// If it's already an absolute path, use it as-is
		if (configuredPath.startsWith('/') || configuredPath.includes('\\')) {
			return configuredPath;
		}

		// Try to resolve to absolute path for better spawn compatibility
		try {
			const { execSync } = require('child_process');
			const os = require('os');

			// Use appropriate command for the platform
			const whichCommand = os.platform() === 'win32'
				? `where ${configuredPath}`
				: `which ${configuredPath}`;

			const output = execSync(whichCommand, {
				encoding: 'utf8',
				env: process.env
			});

			// Split by line and take first result, handling both \r\n and \n
			const resolvedPath = output.split(/\r?\n/)[0].trim();

			if (resolvedPath) {
				getLogger().debug(`Resolved docker path: ${configuredPath} -> ${resolvedPath}`);
				return resolvedPath;
			}
		} catch (error) {
			getLogger().debug(`Could not resolve docker path, using configured: ${configuredPath}`);
		}

		return configuredPath;
	}

	/**
	 * Get Docker Compose path
	 */
	getDockerComposePath(): string {
		return this.config.get<string>('dockerComposePath', 'docker-compose');
	}

	/**
	 * Get Docker socket path
	 */
	getDockerSocketPath(): string {
		return this.config.get<string>('dockerSocketPath', '/var/run/docker.sock');
	}

	/**
	 * Get execute in WSL setting
	 */
	getExecuteInWSL(): boolean {
		return this.config.get<boolean>('executeInWSL', false);
	}

	/**
	 * Get execute in WSL distro setting
	 */
	getExecuteInWSLDistro(): string | undefined {
		return this.config.get<string>('executeInWSLDistro');
	}

	/**
	 * Get forward WSL services setting
	 */
	getForwardWSLServices(): boolean {
		return this.config.get<boolean>('forwardWSLServices', true);
	}

	/**
	 * Get repository configuration paths
	 */
	getRepositoryConfigurationPaths(): string[] {
		return this.config.get<string[]>('repositoryConfigurationPaths', []);
	}

	/**
	 * Get optimistically launch Docker setting
	 */
	getOptimisticallyLaunchDocker(): boolean {
		return this.config.get<boolean>('optimisticallyLaunchDocker', true);
	}
}

/**
 * Convenience function to get the configuration instance
 */
export function getConfiguration(): Configuration {
	return Configuration.getInstance();
}
