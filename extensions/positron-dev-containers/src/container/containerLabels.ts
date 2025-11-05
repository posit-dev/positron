/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthorityType } from '../common/types';

/**
 * Label keys used for tracking dev containers
 */
export const DEV_CONTAINER_LABELS = {
	/**
	 * The local workspace folder path that was used to create this container
	 */
	LOCAL_FOLDER: 'devcontainer.local_folder',

	/**
	 * The config file path that was used to create this container
	 */
	CONFIG_FILE: 'devcontainer.config_file',

	/**
	 * Metadata about the container (JSON string)
	 */
	METADATA: 'devcontainer.metadata',

	/**
	 * The type of container (dev-container or attached-container)
	 */
	TYPE: 'devcontainer.type',

	/**
	 * The timestamp when the container was created
	 */
	CREATED_AT: 'devcontainer.created_at',

	/**
	 * The Positron commit hash used to create this container
	 */
	POSITRON_COMMIT: 'devcontainer.positron_commit',
} as const;

/**
 * Metadata stored in the container labels
 */
export interface ContainerMetadata {
	/**
	 * The type of container
	 */
	type: AuthorityType;

	/**
	 * Created by extension name
	 */
	createdBy: string;

	/**
	 * Creation timestamp
	 */
	timestamp: number;

	/**
	 * Positron version
	 */
	positronVersion?: string;

	/**
	 * Positron commit hash
	 */
	positronCommit?: string;

	/**
	 * Whether this container was built or pulled
	 */
	buildType?: 'built' | 'pulled';

	/**
	 * Additional metadata
	 */
	[key: string]: any;
}

/**
 * Container labels for tracking dev containers
 */
export class ContainerLabels {
	/**
	 * Create labels for a dev container
	 */
	static createLabels(params: {
		localFolder: string;
		configFile: string;
		type: AuthorityType;
		positronCommit?: string;
		additionalMetadata?: Record<string, any>;
	}): Record<string, string> {
		const metadata: ContainerMetadata = {
			type: params.type,
			createdBy: 'positron-dev-containers',
			timestamp: Date.now(),
			positronCommit: params.positronCommit,
			...params.additionalMetadata,
		};

		return {
			[DEV_CONTAINER_LABELS.LOCAL_FOLDER]: params.localFolder,
			[DEV_CONTAINER_LABELS.CONFIG_FILE]: params.configFile,
			[DEV_CONTAINER_LABELS.TYPE]: params.type,
			[DEV_CONTAINER_LABELS.CREATED_AT]: new Date().toISOString(),
			[DEV_CONTAINER_LABELS.METADATA]: JSON.stringify(metadata),
			...(params.positronCommit && {
				[DEV_CONTAINER_LABELS.POSITRON_COMMIT]: params.positronCommit,
			}),
		};
	}

	/**
	 * Parse metadata from container labels
	 */
	static parseMetadata(labels: Record<string, string>): ContainerMetadata | undefined {
		const metadataJson = labels[DEV_CONTAINER_LABELS.METADATA];
		if (!metadataJson) {
			return undefined;
		}

		try {
			return JSON.parse(metadataJson) as ContainerMetadata;
		} catch (error) {
			return undefined;
		}
	}

	/**
	 * Get the local folder from container labels
	 */
	static getLocalFolder(labels: Record<string, string>): string | undefined {
		return labels[DEV_CONTAINER_LABELS.LOCAL_FOLDER];
	}

	/**
	 * Get the config file from container labels
	 */
	static getConfigFile(labels: Record<string, string>): string | undefined {
		return labels[DEV_CONTAINER_LABELS.CONFIG_FILE];
	}

	/**
	 * Get the container type from labels
	 */
	static getType(labels: Record<string, string>): AuthorityType | undefined {
		const type = labels[DEV_CONTAINER_LABELS.TYPE];
		if (type === AuthorityType.DevContainer || type === AuthorityType.AttachedContainer) {
			return type as AuthorityType;
		}
		return undefined;
	}

	/**
	 * Get the creation timestamp from labels
	 */
	static getCreatedAt(labels: Record<string, string>): Date | undefined {
		const createdAt = labels[DEV_CONTAINER_LABELS.CREATED_AT];
		if (!createdAt) {
			return undefined;
		}

		try {
			return new Date(createdAt);
		} catch (error) {
			return undefined;
		}
	}

	/**
	 * Get the Positron commit from labels
	 */
	static getPositronCommit(labels: Record<string, string>): string | undefined {
		return labels[DEV_CONTAINER_LABELS.POSITRON_COMMIT];
	}

	/**
	 * Check if a container is a dev container based on labels
	 */
	static isDevContainer(labels: Record<string, string>): boolean {
		return !!labels[DEV_CONTAINER_LABELS.TYPE];
	}

	/**
	 * Check if a container matches a workspace folder
	 */
	static matchesWorkspace(labels: Record<string, string>, workspaceFolder: string, configFile: string): boolean {
		const localFolder = this.getLocalFolder(labels);
		const containerConfigFile = this.getConfigFile(labels);

		return localFolder === workspaceFolder && containerConfigFile === configFile;
	}

	/**
	 * Convert labels to CLI arguments for docker/podman
	 * Returns an array of ['--label', 'key=value', '--label', 'key=value', ...]
	 */
	static toCliArgs(labels: Record<string, string>): string[] {
		const args: string[] = [];
		for (const [key, value] of Object.entries(labels)) {
			args.push('--label', `${key}=${value}`);
		}
		return args;
	}

	/**
	 * Convert labels to Docker API format
	 * Returns an object with label key-value pairs
	 */
	static toDockerApiFormat(labels: Record<string, string>): Record<string, string> {
		return { ...labels };
	}
}
