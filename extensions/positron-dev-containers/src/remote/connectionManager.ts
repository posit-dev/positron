/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Logger } from '../common/logger';
import { PortForwardingManager } from './portForwarding';
import { installAndStartServer } from '../server/serverInstaller';
import { revokeConnectionToken } from '../server/connectionToken';
import { getDevContainerManager } from '../container/devContainerManager';

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
}

/**
 * Connection result from establishing a connection
 */
export interface ConnectionResult {
	host: string;
	port: number;
	connectionToken: string;
	extensionHostEnv: { [key: string]: string };
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
	async connect(containerId: string): Promise<ConnectionResult> {
		this.logger.info(`===== CONNECTION MANAGER: connect() called =====`);
		this.logger.info(`Establishing connection to container ${containerId}`);

		// Update state
		this.updateConnectionState(containerId, ConnectionState.Connecting);

		try {
			// 1. Ensure container is running
			await this.ensureContainerRunning(containerId);

			// 2. Install Positron server if needed
			this.logger.info('Installing Positron server in container...');
			const serverInfo = await installAndStartServer({
				containerId,
				port: 0  // Use 0 to let the OS pick a random available port
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

			// 5. Set up environment variables
			const extensionHostEnv = this.createExtensionHostEnv(containerId);

			// 6. Store connection info
			const connectionInfo: ConnectionInfo = {
				containerId,
				state: ConnectionState.Connected,
				host: '127.0.0.1',
				port: localPort,
				connectionToken,
				remotePort: serverInfo.port || 0,
				extensionHostEnv,
				connectedAt: new Date()
			};

			this.connections.set(containerId, connectionInfo);
			this.logger.info(`Connection established: ${connectionInfo.host}:${connectionInfo.port}`);

			return {
				host: connectionInfo.host,
				port: connectionInfo.port,
				connectionToken,
				extensionHostEnv
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
	async reconnect(containerId: string, attempt: number = 1): Promise<ConnectionResult> {
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
			return await this.connect(containerId);

		} catch (error) {
			if (attempt < this.maxReconnectAttempts) {
				this.logger.warn(`Reconnection attempt ${attempt} failed, retrying...`);
				return this.reconnect(containerId, attempt + 1);
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
