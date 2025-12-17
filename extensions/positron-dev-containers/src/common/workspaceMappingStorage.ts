/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Logger } from './logger';

/**
 * Workspace mapping between container ID and local workspace path
 */
export interface WorkspaceMapping {
	containerId: string;
	localWorkspacePath: string;
	remoteWorkspacePath?: string;
	timestamp: number; // When mapping was last updated
}

/**
 * Manages persistent storage of workspace mappings using extension global state.
 * Provides both persistent storage and in-memory cache for synchronous access.
 *
 * IMPORTANT: Mappings can be cleared at any time, so always write mappings
 * when opening/reopening containers (idempotent operations).
 */
export class WorkspaceMappingStorage {
	private static readonly STORAGE_KEY = 'positron.devcontainers.workspaceMappings';
	private static instance: WorkspaceMappingStorage | undefined;

	private cache: Map<string, WorkspaceMapping> = new Map();
	private context: vscode.ExtensionContext;
	private logger: Logger;

	private constructor(context: vscode.ExtensionContext, logger: Logger) {
		this.context = context;
		this.logger = logger;
	}

	/**
	 * Initialize the singleton instance
	 */
	static initialize(context: vscode.ExtensionContext, logger: Logger): WorkspaceMappingStorage {
		if (!WorkspaceMappingStorage.instance) {
			WorkspaceMappingStorage.instance = new WorkspaceMappingStorage(context, logger);
		}
		return WorkspaceMappingStorage.instance;
	}

	/**
	 * Get the singleton instance (must be initialized first)
	 */
	static getInstance(): WorkspaceMappingStorage {
		if (!WorkspaceMappingStorage.instance) {
			throw new Error('WorkspaceMappingStorage not initialized. Call initialize() first.');
		}
		return WorkspaceMappingStorage.instance;
	}

	/**
	 * Load all mappings from persistent storage into memory cache.
	 * Call this eagerly on extension activation to ensure synchronous access.
	 */
	async load(): Promise<void> {
		try {
			const stored = this.context.globalState.get<Record<string, WorkspaceMapping>>(
				WorkspaceMappingStorage.STORAGE_KEY,
				{}
			);

			this.cache.clear();
			for (const [containerId, mapping] of Object.entries(stored)) {
				this.cache.set(containerId, mapping);
			}

			this.logger.info(`Loaded ${this.cache.size} workspace mappings from storage`);
		} catch (error) {
			this.logger.error('Failed to load workspace mappings', error);
			// Start with empty cache if loading fails
			this.cache.clear();
		}
	}

	/**
	 * Save a workspace mapping (both to cache and persistent storage).
	 * This is idempotent - safe to call multiple times for the same container.
	 *
	 * @param containerId Container ID
	 * @param localWorkspacePath Local filesystem path
	 * @param remoteWorkspacePath Optional remote path inside container
	 */
	async set(
		containerId: string,
		localWorkspacePath: string,
		remoteWorkspacePath?: string
	): Promise<void> {
		const mapping: WorkspaceMapping = {
			containerId,
			localWorkspacePath,
			remoteWorkspacePath,
			timestamp: Date.now()
		};

		// Update cache immediately (synchronous)
		this.cache.set(containerId, mapping);

		// Persist to global state (async)
		try {
			const stored = this.context.globalState.get<Record<string, WorkspaceMapping>>(
				WorkspaceMappingStorage.STORAGE_KEY,
				{}
			);
			stored[containerId] = mapping;
			await this.context.globalState.update(WorkspaceMappingStorage.STORAGE_KEY, stored);

			this.logger.debug(`Stored workspace mapping: ${containerId} -> ${localWorkspacePath}`);
		} catch (error) {
			this.logger.error(`Failed to persist workspace mapping for ${containerId}`, error);
			// Cache is still updated even if persistence fails
		}
	}

	/**
	 * Get a workspace mapping (synchronous, from cache)
	 *
	 * @param containerId Container ID
	 * @returns Mapping if found, undefined otherwise
	 */
	get(containerId: string): WorkspaceMapping | undefined {
		return this.cache.get(containerId);
	}

	/**
	 * Get the local workspace path for a container (synchronous)
	 *
	 * @param containerId Container ID
	 * @returns Local path if found, undefined otherwise
	 */
	getLocalPath(containerId: string): string | undefined {
		return this.cache.get(containerId)?.localWorkspacePath;
	}

	/**
	 * Get the remote workspace path for a container (synchronous)
	 *
	 * @param containerId Container ID
	 * @returns Remote path if found, undefined otherwise
	 */
	getRemotePath(containerId: string): string | undefined {
		return this.cache.get(containerId)?.remoteWorkspacePath;
	}

	/**
	 * Delete a workspace mapping
	 *
	 * @param containerId Container ID
	 */
	async delete(containerId: string): Promise<void> {
		// Remove from cache immediately
		this.cache.delete(containerId);

		// Remove from persistent storage
		try {
			const stored = this.context.globalState.get<Record<string, WorkspaceMapping>>(
				WorkspaceMappingStorage.STORAGE_KEY,
				{}
			);
			delete stored[containerId];
			await this.context.globalState.update(WorkspaceMappingStorage.STORAGE_KEY, stored);

			this.logger.debug(`Deleted workspace mapping for ${containerId}`);
		} catch (error) {
			this.logger.error(`Failed to delete workspace mapping for ${containerId}`, error);
		}
	}

	/**
	 * Get all mappings (synchronous)
	 */
	getAll(): WorkspaceMapping[] {
		return Array.from(this.cache.values());
	}

	/**
	 * Get all entries as [containerId, mapping] pairs (synchronous)
	 */
	entries(): IterableIterator<[string, WorkspaceMapping]> {
		return this.cache.entries();
	}

	/**
	 * Clear all mappings (for testing/cleanup)
	 */
	async clear(): Promise<void> {
		this.cache.clear();
		await this.context.globalState.update(WorkspaceMappingStorage.STORAGE_KEY, {});
		this.logger.info('Cleared all workspace mappings');
	}

	/**
	 * Clean up old/stale mappings (e.g., for containers that no longer exist)
	 * Can be called periodically or on extension activation.
	 *
	 * @param maxAgeMs Maximum age in milliseconds (default: 30 days)
	 */
	async cleanupStale(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): Promise<void> {
		const now = Date.now();
		const toDelete: string[] = [];

		for (const [containerId, mapping] of this.cache.entries()) {
			if (now - mapping.timestamp > maxAgeMs) {
				toDelete.push(containerId);
			}
		}

		if (toDelete.length > 0) {
			this.logger.info(`Cleaning up ${toDelete.length} stale workspace mappings`);
			for (const containerId of toDelete) {
				await this.delete(containerId);
			}
		}
	}
}
