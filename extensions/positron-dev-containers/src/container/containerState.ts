/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContainerState, DevContainerInfo } from '../common/types';
import { ContainerLabels } from './containerLabels';
import { getLogger } from '../common/logger';

/**
 * Represents detailed information about a container from Docker/Podman inspection
 */
export interface ContainerInspectInfo {
	/**
	 * Container ID
	 */
	Id: string;

	/**
	 * Container name (with leading slash)
	 */
	Name: string;

	/**
	 * Container state
	 */
	State: {
		Status: string;
		Running: boolean;
		Paused: boolean;
		Restarting: boolean;
		OOMKilled: boolean;
		Dead: boolean;
		Pid: number;
		ExitCode: number;
		Error: string;
		StartedAt: string;
		FinishedAt: string;
	};

	/**
	 * Container creation time
	 */
	Created: string;

	/**
	 * Container labels
	 */
	Config: {
		Labels?: Record<string, string>;
		Image?: string;
		Hostname?: string;
		User?: string;
		WorkingDir?: string;
		Env?: string[];
	};

	/**
	 * Image information
	 */
	Image: string;

	/**
	 * Network settings
	 */
	NetworkSettings: {
		Ports?: Record<string, any>;
		IPAddress?: string;
		Networks?: Record<string, any>;
	};

	/**
	 * Mounts
	 */
	Mounts?: Array<{
		Type: string;
		Source: string;
		Destination: string;
		Mode?: string;
		RW?: boolean;
		Propagation?: string;
	}>;
}

/**
 * Container state manager
 */
export class ContainerStateManager {
	/**
	 * Parse container state from Docker status string
	 */
	static parseState(status: string): ContainerState {
		const statusLower = status.toLowerCase();

		if (statusLower.includes('running') || statusLower.includes('up')) {
			return ContainerState.Running;
		} else if (statusLower.includes('paused')) {
			return ContainerState.Paused;
		} else if (statusLower.includes('exited')) {
			return ContainerState.Exited;
		} else if (statusLower.includes('stopped')) {
			return ContainerState.Stopped;
		} else {
			return ContainerState.Unknown;
		}
	}

	/**
	 * Parse state from inspect info
	 */
	static parseStateFromInspect(inspect: ContainerInspectInfo): ContainerState {
		if (inspect.State.Running) {
			return ContainerState.Running;
		} else if (inspect.State.Paused) {
			return ContainerState.Paused;
		} else if (inspect.State.Dead) {
			return ContainerState.Exited;
		} else {
			return ContainerState.Stopped;
		}
	}

	/**
	 * Convert inspect info to DevContainerInfo
	 */
	static fromInspect(inspect: ContainerInspectInfo): DevContainerInfo {
		const labels = inspect.Config.Labels || {};
		const state = this.parseStateFromInspect(inspect);

		// Remove leading slash from container name if present
		const containerName = inspect.Name.startsWith('/') ? inspect.Name.substring(1) : inspect.Name;

		const info: DevContainerInfo = {
			containerId: inspect.Id,
			containerName,
			state,
			imageId: inspect.Image,
			imageName: inspect.Config.Image,
		};

		// Add dev container specific information from labels
		const localFolder = ContainerLabels.getLocalFolder(labels);
		if (localFolder) {
			info.workspaceFolder = localFolder;
		}

		const configFile = ContainerLabels.getConfigFile(labels);
		if (configFile) {
			info.configFilePath = configFile;
		}

		const createdAt = ContainerLabels.getCreatedAt(labels);
		if (createdAt) {
			info.createdAt = createdAt;
		} else {
			// Fallback to container creation time
			try {
				info.createdAt = new Date(inspect.Created);
			} catch (error) {
				getLogger().debug(`Failed to parse container creation time: ${error}`);
			}
		}

		return info;
	}

	/**
	 * Create a simple DevContainerInfo from minimal information
	 */
	static createInfo(params: {
		containerId: string;
		containerName: string;
		state: ContainerState;
		workspaceFolder?: string;
		configFilePath?: string;
		imageId?: string;
		imageName?: string;
	}): DevContainerInfo {
		return {
			containerId: params.containerId,
			containerName: params.containerName,
			state: params.state,
			workspaceFolder: params.workspaceFolder,
			configFilePath: params.configFilePath,
			imageId: params.imageId,
			imageName: params.imageName,
			createdAt: new Date(),
		};
	}

	/**
	 * Check if a container is running
	 */
	static isRunning(info: DevContainerInfo): boolean {
		return info.state === ContainerState.Running;
	}

	/**
	 * Check if a container is stopped
	 */
	static isStopped(info: DevContainerInfo): boolean {
		return info.state === ContainerState.Stopped || info.state === ContainerState.Exited;
	}

	/**
	 * Check if a container can be started
	 */
	static canStart(info: DevContainerInfo): boolean {
		return this.isStopped(info);
	}

	/**
	 * Check if a container can be stopped
	 */
	static canStop(info: DevContainerInfo): boolean {
		return info.state === ContainerState.Running || info.state === ContainerState.Paused;
	}

	/**
	 * Get container short ID (first 12 characters)
	 */
	static getShortId(containerId: string): string {
		return containerId.substring(0, 12);
	}

	/**
	 * Format container display name
	 */
	static getDisplayName(info: DevContainerInfo): string {
		return `${info.containerName} (${this.getShortId(info.containerId)})`;
	}

	/**
	 * Format container state for display
	 */
	static formatState(state: ContainerState): string {
		switch (state) {
			case ContainerState.Running:
				return '$(vm-running) Running';
			case ContainerState.Stopped:
				return '$(vm-outline) Stopped';
			case ContainerState.Paused:
				return '$(debug-pause) Paused';
			case ContainerState.Exited:
				return '$(error) Exited';
			default:
				return '$(question) Unknown';
		}
	}

	/**
	 * Extract workspace folder name from path
	 */
	static getWorkspaceFolderName(workspaceFolder: string): string {
		const parts = workspaceFolder.split(/[/\\]/);
		return parts[parts.length - 1] || workspaceFolder;
	}
}
