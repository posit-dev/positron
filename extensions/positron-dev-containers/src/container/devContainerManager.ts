/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { URI } from 'vscode-uri';
import { getLogger } from '../common/logger';
import { getConfiguration } from '../common/configuration';
import { Workspace } from '../common/workspace';
import { DevContainerInfo } from '../common/types';
import { ContainerLabels } from './containerLabels';
import { ContainerStateManager, ContainerInspectInfo } from './containerState';
import { TerminalBuilder } from './terminalBuilder';

// Import spec library
import { createDockerParams } from '../spec/spec-node/devContainers';
import { readDevContainerConfigFile } from '../spec/spec-node/configContainer';
import { inspectContainer, inspectContainers, listContainers, dockerCLI, ContainerDetails } from '../spec/spec-shutdown/dockerUtils';
import { getCLIHost, loadNativeModule } from '../spec/spec-common/commonUtils';
import { workspaceFromPath } from '../spec/spec-utils/workspaces';
import { makeLog, LogLevel } from '../spec/spec-utils/log';

/**
 * Options for creating/starting a dev container
 */
export interface DevContainerOptions {
	/**
	 * Workspace folder path
	 */
	workspaceFolder: string;

	/**
	 * Config file path (optional, will be auto-detected if not provided)
	 */
	configFilePath?: string;

	/**
	 * Whether to remove existing container and rebuild
	 */
	rebuild?: boolean;

	/**
	 * Whether to skip cache during build
	 */
	noCache?: boolean;

	/**
	 * Additional labels to apply to the container
	 */
	additionalLabels?: Record<string, string>;

	/**
	 * Whether to skip post-create commands
	 */
	skipPostCreate?: boolean;
}

/**
 * Result from creating/starting a container
 */
export interface DevContainerResult {
	/**
	 * Container ID
	 */
	containerId: string;

	/**
	 * Container name
	 */
	containerName: string;

	/**
	 * Container info
	 */
	containerInfo: DevContainerInfo;

	/**
	 * Remote workspace folder path
	 */
	remoteWorkspaceFolder: string;

	/**
	 * Remote user
	 */
	remoteUser: string;
}

/**
 * Dev Container Manager
 * Handles container lifecycle operations using the spec library
 */
export class DevContainerManager {
	private static instance: DevContainerManager;

	private constructor() { }

	/**
	 * Get singleton instance
	 */
	static getInstance(): DevContainerManager {
		if (!DevContainerManager.instance) {
			DevContainerManager.instance = new DevContainerManager();
		}
		return DevContainerManager.instance;
	}

	/**
	 * Create or start a dev container
	 */
	async createOrStartContainer(options: DevContainerOptions): Promise<DevContainerResult> {
		const logger = getLogger();

		logger.info(`Creating/starting dev container for: ${options.workspaceFolder}`);

		// Check if workspace has dev container config
		const workspaceUri = vscode.Uri.file(options.workspaceFolder);
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(workspaceUri);
		if (!workspaceFolder) {
			throw new Error(`Workspace folder not found: ${options.workspaceFolder}`);
		}

		const devContainerPaths = Workspace.getDevContainerPaths(workspaceFolder);
		if (!devContainerPaths) {
			throw new Error('No dev container configuration found');
		}

		const configFilePath = options.configFilePath || devContainerPaths.devContainerJsonPath;

		// Check for existing container
		const existingContainer = await this.findExistingContainer(
			options.workspaceFolder,
			configFilePath
		);

		// If rebuild is requested, remove existing container
		if (existingContainer && options.rebuild) {
			logger.info(`Removing existing container for rebuild: ${existingContainer.containerId}`);
			await this.removeContainer(existingContainer.containerId);
		} else if (existingContainer && !options.rebuild) {
			// Start existing container if stopped
			if (ContainerStateManager.isStopped(existingContainer)) {
				logger.info(`Starting existing container: ${existingContainer.containerId}`);
				await this.startContainer(existingContainer.containerId);
			} else {
				logger.info(`Container already running: ${existingContainer.containerId}`);
			}

			// Get updated container info
			const updatedInfo = await this.getContainerInfo(existingContainer.containerId);
			const inspectInfo = await this.inspectContainerById(existingContainer.containerId);

			// --- Start Positron ---
			// Extract the actual remote workspace folder from container mounts
			let remoteWorkspaceFolder = '/workspaces';
			const workspaceMount = inspectInfo.Mounts?.find(mount =>
				mount.Type === 'bind' && mount.Destination.startsWith('/workspaces/')
			);
			if (workspaceMount) {
				remoteWorkspaceFolder = workspaceMount.Destination;
				logger.info(`Found remote workspace folder from mount: ${remoteWorkspaceFolder}`);
			} else {
				// Fallback: try to generate from local path
				const folderName = options.workspaceFolder.split(/[/\\]/).pop() || 'workspace';
				remoteWorkspaceFolder = `/workspaces/${folderName}`;
				logger.warn(`No workspace mount found, using fallback: ${remoteWorkspaceFolder}`);
			}
			// --- End Positron ---

			return {
				containerId: existingContainer.containerId,
				containerName: existingContainer.containerName,
				containerInfo: updatedInfo,
				remoteWorkspaceFolder,
				remoteUser: inspectInfo.Config.User || 'root',
			};
		}

		// Create new container
		return await this.createContainer(options, configFilePath);
	}

	/**
	 * Create a new dev container
	 */
	private async createContainer(
		options: DevContainerOptions,
		_configFilePath: string
	): Promise<DevContainerResult> {
		const logger = getLogger();

		logger.info('Building container using terminal...');

		// Use terminal-based builder
		const result = await TerminalBuilder.buildAndCreate(
			options.workspaceFolder,
			options.rebuild || false,
			options.noCache || false
		);

		// Get container info
		const containerInfo = await this.getContainerInfo(result.containerId);

		// Get the remote user from the container inspection
		const inspectInfo = await this.inspectContainerById(result.containerId);
		const remoteUser = inspectInfo.Config.User || 'root';

		logger.info(`Container created: ${result.containerId}`);

		return {
			containerId: result.containerId,
			containerName: result.containerName,
			containerInfo,
			remoteWorkspaceFolder: result.remoteWorkspaceFolder,
			remoteUser,
		};
	}

	/**
	 * Find existing container for a workspace
	 */
	async findExistingContainer(
		workspaceFolder: string,
		configFilePath: string
	): Promise<DevContainerInfo | undefined> {
		const logger = getLogger();
		logger.debug(`Looking for existing container: ${workspaceFolder}`);

		try {
			// Get docker params for querying
			const params = await this.createDockerParams();

			// List all container IDs
			const containerIds = await listContainers(params, true, undefined);

			if (containerIds.length === 0) {
				return undefined;
			}

			// Inspect all containers to get their details
			const containers = await inspectContainers(params, containerIds);

			// Find container matching workspace and config
			for (const container of containers) {
				const rawLabels = container.Config.Labels || {};
				// Filter out undefined values to match expected type
				const labels: Record<string, string> = {};
				for (const [key, value] of Object.entries(rawLabels)) {
					if (value !== undefined && value !== null) {
						labels[key] = value;
					}
				}

				if (ContainerLabels.matchesWorkspace(labels, workspaceFolder, configFilePath)) {
					return ContainerStateManager.fromInspect(this.toContainerInspectInfo(container));
				}
			}

			return undefined;
		} catch (error) {
			logger.error('Failed to find existing container', error);
			return undefined;
		}
	}

	/**
	 * Get container info by ID
	 */
	async getContainerInfo(containerId: string): Promise<DevContainerInfo> {
		const logger = getLogger();
		logger.debug(`Getting container info: ${containerId}`);

		try {
			const params = await this.createDockerParams();
			const details = await inspectContainer(params, containerId);
			return ContainerStateManager.fromInspect(this.toContainerInspectInfo(details));
		} catch (error) {
			// Only log as error if it's not a Docker availability issue
			const errorMsg = error instanceof Error ? error.message : String(error);
			if (errorMsg.includes('ENOENT') || errorMsg.includes('spawn')) {
				logger.debug('Failed to get container info - Docker not available', error);
			} else {
				logger.error('Failed to get container info', error);
			}
			throw new Error(`Failed to get container info: ${error}`);
		}
	}

	/**
	 * Get detailed container inspection info including mounts
	 */
	async inspectContainerDetails(containerId: string): Promise<ContainerInspectInfo> {
		const logger = getLogger();
		logger.debug(`Inspecting container details: ${containerId}`);

		try {
			const params = await this.createDockerParams();
			const details = await inspectContainer(params, containerId);
			return this.toContainerInspectInfo(details);
		} catch (error) {
			// Only log as error if it's not a Docker availability issue
			const errorMsg = error instanceof Error ? error.message : String(error);
			if (errorMsg.includes('ENOENT') || errorMsg.includes('spawn')) {
				logger.debug('Failed to inspect container details - Docker not available', error);
			} else {
				logger.error('Failed to inspect container details', error);
			}
			throw new Error(`Failed to inspect container details: ${error}`);
		}
	}

	/**
	 * List all dev containers
	 */
	async listDevContainers(): Promise<DevContainerInfo[]> {
		const logger = getLogger();
		logger.debug('Listing dev containers');

		try {
			const params = await this.createDockerParams();
			const containerIds = await listContainers(params, true, undefined);

			if (containerIds.length === 0) {
				return [];
			}

			const containers = await inspectContainers(params, containerIds);

			const devContainers: DevContainerInfo[] = [];

			for (const container of containers) {
				const rawLabels = container.Config.Labels || {};
				// Filter out undefined values to match expected type
				const labels: Record<string, string> = {};
				for (const [key, value] of Object.entries(rawLabels)) {
					if (value !== undefined && value !== null) {
						labels[key] = value;
					}
				}

				// Check if this is a dev container
				if (ContainerLabels.isDevContainer(labels)) {
					try {
						const info = ContainerStateManager.fromInspect(this.toContainerInspectInfo(container));
						devContainers.push(info);
					} catch (error) {
						logger.error(`Failed to process container ${container.Id}`, error);
					}
				}
			}

			return devContainers;
		} catch (error) {
			logger.error('Failed to list dev containers', error);
			return [];
		}
	}

	/**
	 * Start a stopped container
	 */
	async startContainer(containerId: string): Promise<void> {
		const logger = getLogger();
		logger.info(`Starting container: ${containerId}`);

		try {
			const params = await this.createDockerParams();
			await dockerCLI(params, 'start', containerId);
			logger.info(`Container started: ${containerId}`);
		} catch (error) {
			logger.error('Failed to start container', error);
			throw new Error(`Failed to start container: ${error}`);
		}
	}

	/**
	 * Stop a running container
	 */
	async stopContainer(containerId: string): Promise<void> {
		const logger = getLogger();
		logger.info(`Stopping container: ${containerId}`);

		try {
			const params = await this.createDockerParams();
			await dockerCLI(params, 'stop', containerId);
			logger.info(`Container stopped: ${containerId}`);
		} catch (error) {
			logger.error('Failed to stop container', error);
			throw new Error(`Failed to stop container: ${error}`);
		}
	}

	/**
	 * Remove a container
	 */
	async removeContainer(containerId: string, force: boolean = true): Promise<void> {
		const logger = getLogger();
		logger.info(`Removing container: ${containerId}`);

		try {
			const params = await this.createDockerParams();
			const args = ['rm'];
			if (force) {
				args.push('--force');
			}
			args.push(containerId);
			await dockerCLI(params, ...args);
			logger.info(`Container removed: ${containerId}`);
		} catch (error) {
			logger.error('Failed to remove container', error);
			throw new Error(`Failed to remove container: ${error}`);
		}
	}

	/**
	 * Get container logs
	 */
	async getContainerLogs(containerId: string, lines: number = 100): Promise<string> {
		const logger = getLogger();
		logger.debug(`Getting container logs: ${containerId}`);

		try {
			const params = await this.createDockerParams();
			const result = await dockerCLI(params, 'logs', '--tail', lines.toString(), containerId);
			return result.stdout.toString();
		} catch (error) {
			logger.error('Failed to get container logs', error);
			throw new Error(`Failed to get container logs: ${error}`);
		}
	}

	/**
	 * Read dev container configuration
	 */
	async readConfiguration(workspaceFolder: string, configFilePath: string): Promise<any> {
		const logger = getLogger();
		logger.debug(`Reading config: ${configFilePath}`);

		try {
			const cliHost = await getCLIHost(workspaceFolder, loadNativeModule, false);
			const workspace = workspaceFromPath(cliHost.path, workspaceFolder);
			const configUri = URI.file(configFilePath);

			const output = makeLog({
				event: (e) => {
					if (e.type === 'text') {
						logger.debug(e.text);
					}
				},
				dimensions: { columns: 0, rows: 0 },
			}, LogLevel.Info);

			const config = await readDevContainerConfigFile(
				cliHost,
				workspace,
				configUri,
				false, // mountWorkspaceGitRoot
				output
			);

			return config;
		} catch (error) {
			logger.error('Failed to read configuration', error);
			throw new Error(`Failed to read configuration: ${error}`);
		}
	}

	/**
	 * Clean up stopped dev containers
	 */
	async cleanupStoppedContainers(): Promise<number> {
		const logger = getLogger();
		logger.info('Cleaning up stopped dev containers');

		try {
			const devContainers = await this.listDevContainers();
			const stoppedContainers = devContainers.filter(c =>
				ContainerStateManager.isStopped(c)
			);

			logger.info(`Found ${stoppedContainers.length} stopped dev containers`);

			for (const container of stoppedContainers) {
				try {
					await this.removeContainer(container.containerId);
					logger.info(`Removed: ${container.containerName}`);
				} catch (error) {
					logger.error(`Failed to remove ${container.containerName}`, error);
				}
			}

			return stoppedContainers.length;
		} catch (error) {
			logger.error('Failed to cleanup containers', error);
			return 0;
		}
	}

	/**
	 * Check if Docker is available
	 */
	async isDockerAvailable(): Promise<boolean> {
		const logger = getLogger();

		// Docker is never available in remote context (UI extension running inside container)
		if (vscode.env.remoteName) {
			logger.debug(`Docker not available in remote context (${vscode.env.remoteName})`);
			return false;
		}

		try {
			const params = await this.createDockerParams();
			await dockerCLI(params, 'version');
			return true;
		} catch (error) {
			logger.debug('Docker not available', error);
			return false;
		}
	}

	/**
	 * Create Docker resolver parameters
	 */
	private async createDockerParams(): Promise<any> {
		const config = getConfiguration();
		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

		const disposables: (() => Promise<unknown> | undefined)[] = [];

		const params = await createDockerParams({
			dockerPath: config.getDockerPath(),
			dockerComposePath: config.getDockerComposePath(),
			containerDataFolder: undefined,
			containerSystemDataFolder: undefined,
			workspaceFolder: cwd,
			workspaceMountConsistency: config.getWorkspaceMountConsistency(),
			gpuAvailability: config.getGpuAvailability(),
			mountWorkspaceGitRoot: false,
			configFile: undefined,
			overrideConfigFile: undefined,
			logLevel: config.getLogLevel() as any,
			logFormat: 'text',
			log: (text: string) => getLogger().debug(text),
			terminalDimensions: undefined,
			defaultUserEnvProbe: 'loginInteractiveShell',
			removeExistingContainer: false,
			buildNoCache: false,
			expectExistingContainer: false,
			postCreateEnabled: false,
			skipNonBlocking: false,
			prebuild: false,
			persistedFolder: undefined,
			additionalMounts: [],
			updateRemoteUserUIDDefault: 'never',
			remoteEnv: {},
			additionalCacheFroms: [],
			useBuildKit: 'auto',
			omitLoggerHeader: true,
			buildxPlatform: undefined,
			buildxPush: false,
			additionalLabels: [],
			buildxOutput: undefined,
			buildxCacheTo: undefined,
			skipFeatureAutoMapping: false,
			skipPostAttach: true,
			skipPersistingCustomizationsFromFeatures: false,
			dotfiles: {},
		}, disposables);

		return params;
	}

	/**
	 * Inspect container by ID
	 */
	private async inspectContainerById(containerId: string): Promise<ContainerInspectInfo> {
		const params = await this.createDockerParams();
		const details = await inspectContainer(params, containerId);
		return this.toContainerInspectInfo(details);
	}

	/**
	 * Convert ContainerDetails to ContainerInspectInfo
	 */
	private toContainerInspectInfo(details: ContainerDetails): ContainerInspectInfo {
		// Filter out undefined values from labels
		const rawLabels = details.Config.Labels || {};
		const labels: Record<string, string> = {};
		for (const [key, value] of Object.entries(rawLabels)) {
			if (value !== undefined && value !== null) {
				labels[key] = value;
			}
		}

		return {
			Id: details.Id,
			Name: details.Name,
			State: {
				Status: details.State.Status,
				Running: details.State.Status.toLowerCase() === 'running',
				Paused: details.State.Status.toLowerCase() === 'paused',
				Restarting: false,
				OOMKilled: false,
				Dead: details.State.Status.toLowerCase() === 'dead',
				Pid: 0,
				ExitCode: 0,
				Error: '',
				StartedAt: details.State.StartedAt,
				FinishedAt: details.State.FinishedAt,
			},
			Created: details.Created,
			Config: {
				Labels: Object.keys(labels).length > 0 ? labels : undefined,
				Image: details.Config.Image,
				Hostname: undefined,
				User: details.Config.User,
				WorkingDir: undefined,
				Env: details.Config.Env || undefined,
			},
			Image: details.Config.Image,
			NetworkSettings: {
				Ports: details.NetworkSettings.Ports,
				IPAddress: undefined,
				Networks: undefined,
			},
			Mounts: details.Mounts,
		};
	}
}

/**
 * Get the dev container manager instance
 */
export function getDevContainerManager(): DevContainerManager {
	return DevContainerManager.getInstance();
}

