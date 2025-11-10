/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Logger } from '../common/logger';
import { PortForwardingManager } from './portForwarding';
import { installAndStartServer } from '../server/serverInstaller';
import { revokeConnectionToken } from '../server/connectionToken';
import { getDevContainerManager } from '../container/devContainerManager';
import { decodeDevContainerAuthority } from '../common/authorityEncoding';
import { WorkspaceMappingStorage } from '../common/workspaceMappingStorage';

/**
 * Connection state
 */
export enum ConnectionState {
	Disconnected = 'disconnected',
	Connecting = 'connecting',
	Connected = 'connected',
	Reconnecting = 'reconnecting',
	Failed = 'failed'
}

/**
 * Connection information
 */
export interface ConnectionInfo {
	containerId: string;
	state: ConnectionState;
	host: string;
	port: number;
	connectionToken: string;
	remotePort: number;
	extensionHostEnv?: { [key: string]: string };
	connectedAt?: Date;
	lastError?: string;
	// --- Start Positron ---
	// Workspace path mapping for URI remapping
	localWorkspacePath?: string;  // e.g., /Users/jmcphers/git/cli
	remoteWorkspacePath?: string; // e.g., /workspaces/cli
	// --- End Positron ---
}

/**
 * Connection result from establishing a connection
 */
export interface ConnectionResult {
	host: string;
	port: number;
	connectionToken: string;
	extensionHostEnv: { [key: string]: string };
	// --- Start Positron ---
	localWorkspacePath?: string;
	remoteWorkspacePath?: string;
	// --- End Positron ---
}

/**
 * Manages connections to dev containers
 */
export class ConnectionManager {
	private connections = new Map<string, ConnectionInfo>();
	private logger: Logger;
	private portForwardingManager: PortForwardingManager;

	// Reconnection settings
	private readonly maxReconnectAttempts = 3;
	private readonly reconnectDelay = 2000; // ms

	constructor(
		logger: Logger,
		portForwardingManager: PortForwardingManager
	) {
		this.logger = logger;
		this.portForwardingManager = portForwardingManager;
	}

	/**
	 * Establish a connection to a container
	 */
	async connect(containerId: string, authority: string): Promise<ConnectionResult> {
		this.logger.info(`===== CONNECTION MANAGER: connect() called =====`);
		this.logger.info(`Establishing connection to container ${containerId}`);

		// Update state
		this.updateConnectionState(containerId, ConnectionState.Connecting);

		try {
			// 1. Ensure container is running
			await this.ensureContainerRunning(containerId);

			// 2. Get workspace path mapping from container
			// --- Start Positron ---
			let localWorkspacePath: string | undefined;
			let remoteWorkspacePath: string | undefined;

			// Try to get local workspace path from storage first (for MRU reopens)
			try {
				const storage = WorkspaceMappingStorage.getInstance();
				const mapping = storage.get(containerId);
				if (mapping?.localWorkspacePath) {
					localWorkspacePath = mapping.localWorkspacePath;
					this.logger.info(`Local workspace path from storage: ${localWorkspacePath}`);
				}
			} catch (error) {
				this.logger.debug('WorkspaceMappingStorage not initialized yet, will try other methods');
			}

			// Fallback: Extract local workspace path from authority (for initial opens with encoded path)
			if (!localWorkspacePath) {
				const decoded = decodeDevContainerAuthority(authority);
				if (decoded?.localWorkspacePath) {
					localWorkspacePath = decoded.localWorkspacePath;
					this.logger.info(`Local workspace path from authority: ${localWorkspacePath}`);
				}
			}

			// Get remote workspace path - but only if Docker is available (not in remote context)
			// In remote context, Docker won't be available and we don't need to inspect
			try {
				const containerManager = getDevContainerManager();
				const containerDetails = await containerManager.inspectContainerDetails(containerId);

				// Find the workspace mount to determine remote path
				const workspaceMount = containerDetails.Mounts?.find(mount =>
					mount.Type === 'bind' && mount.Destination.startsWith('/workspaces/')
				);
				if (workspaceMount) {
					remoteWorkspacePath = workspaceMount.Destination;
					this.logger.info(`Remote workspace path from mount: ${remoteWorkspacePath}`);
				} else if (localWorkspacePath) {
					// Fallback: construct from local path
					const folderName = localWorkspacePath.split(/[/\\]/).pop() || 'workspace';
					remoteWorkspacePath = `/workspaces/${folderName}`;
					this.logger.warn(`No workspace mount found, using fallback: ${remoteWorkspacePath}`);
				}
			} catch (error) {
				// If container inspection fails (e.g., in remote context), construct from local path
				if (localWorkspacePath) {
					const folderName = localWorkspacePath.split(/[/\\]/).pop() || 'workspace';
					remoteWorkspacePath = `/workspaces/${folderName}`;
					this.logger.info(`Container inspection failed, using fallback remote path: ${remoteWorkspacePath}`);
				}
			}

			// 3. Set up environment variables BEFORE starting server
			const extensionHostEnv = this.createExtensionHostEnv(containerId);

			// Add workspace paths to environment
			if (localWorkspacePath) {
				extensionHostEnv.LOCAL_WORKSPACE_FOLDER = localWorkspacePath;
				this.logger.info(`Setting LOCAL_WORKSPACE_FOLDER in extensionHostEnv: ${localWorkspacePath}`);
			} else {
				this.logger.warn('No localWorkspacePath available to set in extensionHostEnv');
			}
			if (remoteWorkspacePath) {
				extensionHostEnv.CONTAINER_WORKSPACE_FOLDER = remoteWorkspacePath;
				this.logger.info(`Setting CONTAINER_WORKSPACE_FOLDER in extensionHostEnv: ${remoteWorkspacePath}`);
			} else {
				this.logger.warn('No remoteWorkspacePath available to set in extensionHostEnv');
			}
			// --- End Positron ---

			// 3. Install Positron server with environment variables
			this.logger.info('Installing Positron server in container...');
			const serverInfo = await installAndStartServer({
				containerId,
				port: 0,  // Use 0 to let the OS pick a random available port
				extensionHostEnv
			});
			this.logger.info(`Server installed. Listening on ${serverInfo.isPort ? 'port ' + serverInfo.port : 'socket ' + serverInfo.socketPath}`);

			// 3. Forward the port (if using port instead of socket)
			let localPort: number;
			if (serverInfo.isPort && serverInfo.port) {
				this.logger.info(`Forwarding port ${serverInfo.port} to localhost...`);
				localPort = await this.portForwardingManager.forwardPort(
					containerId,
					serverInfo.port
				);
			} else {
				// For socket-based connections, we'll use a default port
				// The actual socket path will be used directly
				this.logger.info(`Using socket path: ${serverInfo.socketPath}`);
				localPort = 0; // Socket-based connection
			}

			// 4. Use the connection token from the server
			// The server was started with this token, so we must use the same one
			const connectionToken = serverInfo.connectionToken;

			// 5. Store connection info
			const connectionInfo: ConnectionInfo = {
				containerId,
				state: ConnectionState.Connected,
				host: '127.0.0.1',
				port: localPort,
				connectionToken,
				remotePort: serverInfo.port || 0,
				extensionHostEnv,
				connectedAt: new Date(),
				// --- Start Positron ---
				localWorkspacePath,
				remoteWorkspacePath
				// --- End Positron ---
			};

			this.connections.set(containerId, connectionInfo);
			this.logger.info(`Connection established: ${connectionInfo.host}:${connectionInfo.port}`);

			// --- Start Positron ---
			// Store workspace mapping in global state for persistence
			// This is idempotent and ensures mapping is always fresh even if state was cleared
			if (localWorkspacePath) {
				try {
					const storage = WorkspaceMappingStorage.getInstance();
					await storage.set(containerId, localWorkspacePath, remoteWorkspacePath);
					this.logger.info(`Stored workspace mapping: ${containerId} -> ${localWorkspacePath}`);
				} catch (error) {
					this.logger.warn('Failed to store workspace mapping', error);
					// Don't fail connection if storage fails
				}
			}
			// --- End Positron ---

			this.logger.debug('=== CONNECTION: Returning connection result ===');
			this.logger.debug(`extensionHostEnv keys: ${Object.keys(extensionHostEnv).join(', ')}`);
			this.logger.debug(`extensionHostEnv: ${JSON.stringify(extensionHostEnv, null, 2)}`);

			return {
				host: connectionInfo.host,
				port: connectionInfo.port,
				connectionToken,
				extensionHostEnv,
				// --- Start Positron ---
				localWorkspacePath,
				remoteWorkspacePath
				// --- End Positron ---
			};

		} catch (error) {
			this.logger.error(`Failed to establish connection to ${containerId}`, error);
			this.updateConnectionState(containerId, ConnectionState.Failed, error);
			throw error;
		}
	}

	/**
	 * Reconnect to a container
	 */
	async reconnect(containerId: string, authority: string, attempt: number = 1): Promise<ConnectionResult> {
		this.logger.info(`Reconnecting to container ${containerId} (attempt ${attempt}/${this.maxReconnectAttempts})`);

		this.updateConnectionState(containerId, ConnectionState.Reconnecting);

		try {
			// Clean up old connection
			await this.disconnect(containerId);

			// Wait before reconnecting
			if (attempt > 1) {
				await this.delay(this.reconnectDelay * attempt);
			}

			// Attempt to reconnect
			return await this.connect(containerId, authority);

		} catch (error) {
			if (attempt < this.maxReconnectAttempts) {
				this.logger.warn(`Reconnection attempt ${attempt} failed, retrying...`);
				return this.reconnect(containerId, authority, attempt + 1);
			} else {
				this.logger.error(`Failed to reconnect after ${this.maxReconnectAttempts} attempts`);
				this.updateConnectionState(containerId, ConnectionState.Failed, error);
				throw error;
			}
		}
	}

	/**
	 * Disconnect from a container
	 */
	async disconnect(containerId: string): Promise<void> {
		this.logger.info(`Disconnecting from container ${containerId}`);

		const connection = this.connections.get(containerId);
		if (!connection) {
			this.logger.debug(`No active connection to ${containerId}`);
			return;
		}

		try {
			// Stop port forwarding
			await this.portForwardingManager.stopAllForContainer(containerId);

			// Note: Server stopping is not implemented yet in Phase 4
			// Will be added in later phases if needed

			// Revoke connection token
			revokeConnectionToken(connection.connectionToken);

			// Update state
			this.updateConnectionState(containerId, ConnectionState.Disconnected);

			// Remove connection
			this.connections.delete(containerId);

			this.logger.info(`Disconnected from container ${containerId}`);

		} catch (error) {
			this.logger.error(`Error during disconnect from ${containerId}`, error);
		}
	}

	/**
	 * Get connection info for a container
	 */
	getConnection(containerId: string): ConnectionInfo | undefined {
		return this.connections.get(containerId);
	}

	/**
	 * Check if connected to a container
	 */
	isConnected(containerId: string): boolean {
		const connection = this.connections.get(containerId);
		return connection?.state === ConnectionState.Connected;
	}

	/**
	 * Get all active connections
	 */
	getAllConnections(): ConnectionInfo[] {
		return Array.from(this.connections.values());
	}

	/**
	 * Disconnect all connections
	 */
	async disconnectAll(): Promise<void> {
		const containerIds = Array.from(this.connections.keys());
		for (const containerId of containerIds) {
			await this.disconnect(containerId);
		}
	}

	/**
	 * Ensure container is running
	 */
	private async ensureContainerRunning(containerId: string): Promise<void> {
		// --- Start Positron ---
		// Skip docker operations when running in remote context (docker not available)
		// We can detect this by checking if docker commands will fail
		try {
			this.logger.debug(`Checking if container ${containerId} is running`);

			const containerManager = getDevContainerManager();
			const containerInfo = await containerManager.getContainerInfo(containerId);

			if (containerInfo.state === 'running') {
				this.logger.debug(`Container ${containerId} is running`);
				return;
			}

			if (containerInfo.state === 'stopped' || containerInfo.state === 'exited') {
				this.logger.info(`Starting stopped container ${containerId}`);
				await containerManager.startContainer(containerId);
				return;
			}

			throw new Error(`Container ${containerId} is not in a valid state: ${containerInfo.state || 'unknown'}`);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			if (errorMsg.includes('ENOENT') || errorMsg.includes('spawn docker')) {
				// Docker not available - we're probably running in remote context
				// Assume container is running since we're being asked to connect to it
				this.logger.debug(`Docker not available (remote context), assuming container ${containerId} is running`);
				return;
			}
			// Re-throw other errors
			throw error;
		}
		// --- End Positron ---
	}

	/**
	 * Create environment variables for extension host
	 */
	private createExtensionHostEnv(containerId: string): { [key: string]: string } {
		// These environment variables will be available in the extension host running in the container
		return {
			POSITRON_CONTAINER_ID: containerId,
			POSITRON_REMOTE_ENV: 'devcontainer',
			// Add other environment variables as needed
		};
	}

	/**
	 * Update connection state
	 */
	private updateConnectionState(
		containerId: string,
		state: ConnectionState,
		error?: any
	): void {
		const connection = this.connections.get(containerId);
		if (connection) {
			connection.state = state;
			if (error) {
				connection.lastError = error.message || String(error);
			}
		} else {
			// Create new connection entry
			this.connections.set(containerId, {
				containerId,
				state,
				host: '',
				port: 0,
				connectionToken: '',
				remotePort: 0,
				lastError: error ? (error.message || String(error)) : undefined
			});
		}
	}

	/**
	 * Delay helper
	 */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Cleanup all resources
	 */
	dispose(): void {
		this.disconnectAll();
	}
}
