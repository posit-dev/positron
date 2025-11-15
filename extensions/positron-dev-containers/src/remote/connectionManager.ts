/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Logger } from '../common/logger';
import { PortForwardingManager } from './portForwarding';
import { installAndStartServer } from '../server/serverInstaller';
import { revokeConnectionToken } from '../server/connectionToken';
import { getDevContainerManager } from '../container/devContainerManager';
import { decodeDevContainerAuthority } from '../common/authorityEncoding';
import { WorkspaceMappingStorage } from '../common/workspaceMappingStorage';
import { getConfiguration } from '../common/configuration';

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
	// Workspace path mapping for URI remapping
	localWorkspacePath?: string;  // e.g., /Users/jmcphers/git/cli
	remoteWorkspacePath?: string; // e.g., /workspaces/cli
}

/**
 * Connection result from establishing a connection
 */
export interface ConnectionResult {
	host: string;
	port: number;
	connectionToken: string;
	extensionHostEnv: { [key: string]: string };
	localWorkspacePath?: string;
	remoteWorkspacePath?: string;
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
	 * @param containerIdOrWorkspace Container ID or workspace folder name
	 * @param authority Full authority string
	 */
	async connect(containerIdOrWorkspace: string, authority: string): Promise<ConnectionResult> {
		this.logger.info(`Establishing connection with identifier: ${containerIdOrWorkspace}`);

		// Resolve workspace name to container ID if needed
		const containerId = await this.resolveContainerId(containerIdOrWorkspace);
		this.logger.debug(`Resolved to container ID: ${containerId}`);

		// Update state
		this.updateConnectionState(containerId, ConnectionState.Connecting);

		try {
			// 1. Ensure container is running
			await this.ensureContainerRunning(containerId);

			// 2. Get workspace path mapping from container
			let localWorkspacePath: string | undefined;
			let remoteWorkspacePath: string | undefined;

			// Try to get local workspace path from storage first (for MRU reopens)
			try {
				const storage = WorkspaceMappingStorage.getInstance();
				const mapping = storage.get(containerId);
				if (mapping?.localWorkspacePath) {
					localWorkspacePath = mapping.localWorkspacePath;
					this.logger.debug(`Local workspace path from storage: ${localWorkspacePath}`);
				}
			} catch (error) {
				this.logger.trace('WorkspaceMappingStorage not initialized yet, will try other methods');
			}

			// Fallback: Extract local workspace path from authority (for initial opens with encoded path)
			if (!localWorkspacePath) {
				const decoded = decodeDevContainerAuthority(authority);
				if (decoded?.localWorkspacePath) {
					localWorkspacePath = decoded.localWorkspacePath;
					this.logger.debug(`Local workspace path from authority: ${localWorkspacePath}`);
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
					this.logger.debug(`Remote workspace path from mount: ${remoteWorkspacePath}`);
				} else if (localWorkspacePath) {
					// Fallback: construct from local path
					const folderName = localWorkspacePath.split(/[/\\]/).pop() || 'workspace';
					remoteWorkspacePath = `/workspaces/${folderName}`;
					this.logger.debug(`No workspace mount found, using fallback: ${remoteWorkspacePath}`);
				}
			} catch (error) {
				// If container inspection fails (e.g., in remote context), construct from local path
				if (localWorkspacePath) {
					const folderName = localWorkspacePath.split(/[/\\]/).pop() || 'workspace';
					remoteWorkspacePath = `/workspaces/${folderName}`;
					this.logger.debug(`Container inspection failed, using fallback remote path: ${remoteWorkspacePath}`);
				}
			}

			// 3. Set up environment variables BEFORE starting server
			const extensionHostEnv = this.createExtensionHostEnv(containerId);

			// Add workspace paths to environment
			if (localWorkspacePath) {
				extensionHostEnv.LOCAL_WORKSPACE_FOLDER = localWorkspacePath;
				this.logger.debug(`Setting LOCAL_WORKSPACE_FOLDER: ${localWorkspacePath}`);
			} else {
				this.logger.debug('No localWorkspacePath available');
			}
			if (remoteWorkspacePath) {
				extensionHostEnv.CONTAINER_WORKSPACE_FOLDER = remoteWorkspacePath;
				this.logger.debug(`Setting CONTAINER_WORKSPACE_FOLDER: ${remoteWorkspacePath}`);
			} else {
				this.logger.debug('No remoteWorkspacePath available');
			}

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
				this.logger.debug(`Forwarding port ${serverInfo.port} to localhost`);
				localPort = await this.portForwardingManager.forwardPort(
					containerId,
					serverInfo.port
				);
			} else {
				// For socket-based connections, we'll use a default port
				// The actual socket path will be used directly
				this.logger.debug(`Using socket path: ${serverInfo.socketPath}`);
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
				localWorkspacePath,
				remoteWorkspacePath
			};

			this.connections.set(containerId, connectionInfo);
			this.logger.info(`Connection established: ${connectionInfo.host}:${connectionInfo.port}`);

			// Store workspace mapping in global state for persistence
			// This is idempotent and ensures mapping is always fresh even if state was cleared
			if (localWorkspacePath) {
				try {
					const storage = WorkspaceMappingStorage.getInstance();
					await storage.set(containerId, localWorkspacePath, remoteWorkspacePath);
					this.logger.debug(`Stored workspace mapping: ${containerId} -> ${localWorkspacePath}`);
				} catch (error) {
					this.logger.debug('Failed to store workspace mapping', error);
					// Don't fail connection if storage fails
				}
			}

			this.logger.trace(`Extension host env keys: ${Object.keys(extensionHostEnv).join(', ')}`);
			this.logger.trace(`Extension host env: ${JSON.stringify(extensionHostEnv, null, 2)}`);

			return {
				host: connectionInfo.host,
				port: connectionInfo.port,
				connectionToken,
				extensionHostEnv,
				localWorkspacePath,
				remoteWorkspacePath
			};

		} catch (error) {
			this.logger.error(`Failed to establish connection to ${containerId}`, error);
			this.updateConnectionState(containerId, ConnectionState.Failed, error);

			// Check if this is a server installation failure
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (errorMessage.includes('Installation script failed') || errorMessage.includes('Failed to install server')) {
				// Extract log file path and show helpful error message
				await this.handleServerInstallationError(containerId, errorMessage);
			}

			throw error;
		}
	}

	/**
	 * Reconnect to a container
	 */
	async reconnect(containerId: string, authority: string, attempt: number = 1): Promise<ConnectionResult> {
		this.logger.debug(`Reconnecting to container ${containerId} (attempt ${attempt}/${this.maxReconnectAttempts})`);

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
		this.logger.debug(`Disconnecting from container ${containerId}`);

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

			this.logger.debug(`Disconnected from container ${containerId}`);

		} catch (error) {
			this.logger.error(`Error during disconnect from ${containerId}`, error);
		}
	}

	/**
	 * Get connection info for a container
	 * Supports container IDs, short ID prefixes, and workspace names
	 */
	getConnection(identifier: string): ConnectionInfo | undefined {
		// Try exact match first (full container ID)
		const exact = this.connections.get(identifier);
		if (exact) {
			return exact;
		}

		// Try prefix match (for short IDs)
		if (identifier.length === 8) {
			for (const [fullId, info] of this.connections.entries()) {
				if (fullId.startsWith(identifier)) {
					return info;
				}
			}
		}

		// Try workspace name match
		// Check if any connection's remote workspace path ends with this identifier
		for (const info of this.connections.values()) {
			if (info.remoteWorkspacePath) {
				const workspaceName = info.remoteWorkspacePath.split('/').filter(s => s).pop();
				if (workspaceName === identifier) {
					return info;
				}
			}
		}

		return undefined;
	}

	/**
	 * Resolve a workspace name or container ID to the actual container ID
	 * @param identifier Workspace folder name or container ID
	 * @returns Full container ID
	 */
	private async resolveContainerId(identifier: string): Promise<string> {
		// If it looks like a container ID (long hash), use it directly
		if (identifier.length > 12 && /^[a-f0-9]+$/.test(identifier)) {
			return identifier;
		}

		// Try to find a container with this workspace name
		// If multiple containers match, use the most recent one (highest timestamp)
		const storage = WorkspaceMappingStorage.getInstance();
		let bestMatch: { containerId: string; timestamp: number } | undefined;

		for (const [containerId, mapping] of storage.entries()) {
			if (mapping.remoteWorkspacePath) {
				const workspaceName = mapping.remoteWorkspacePath.split('/').filter(s => s).pop();
				if (workspaceName === identifier) {
					// Found a match - check if it's more recent than the current best
					if (!bestMatch || mapping.timestamp > bestMatch.timestamp) {
						bestMatch = { containerId, timestamp: mapping.timestamp };
					}
				}
			}
		}

		if (bestMatch) {
			this.logger.debug(`Resolved workspace name "${identifier}" to container ${bestMatch.containerId}`);
			return bestMatch.containerId;
		}

		// Couldn't resolve - assume it's already a container ID
		this.logger.warn(`Could not resolve "${identifier}" to a container ID, using as-is`);
		return identifier;
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
	 * Handle server installation errors by showing a toast with option to view logs
	 */
	private async handleServerInstallationError(containerId: string, errorMessage: string): Promise<void> {
		// Extract log file path from error message
		const logPath = this.extractLogFilePath(errorMessage);

		if (logPath) {
			this.logger.info(`Server installation failed. Log file: ${logPath}`);

			// Show error message with button to view log
			const viewLogButton = vscode.l10n.t('View Log');
			const result = await vscode.window.showErrorMessage(
				vscode.l10n.t('Failed to install Positron server in container. Click "View Log" to see details.'),
				viewLogButton
			);

			if (result === viewLogButton) {
				await this.showServerLog(containerId, logPath);
			}
		} else {
			// Fallback if we can't extract log path
			this.logger.warn('Could not extract log file path from error message');
			await vscode.window.showErrorMessage(
				vscode.l10n.t('Failed to install Positron server in container. Check the extension output for details.')
			);
		}
	}

	/**
	 * Extract log file path from error message
	 */
	private extractLogFilePath(errorMessage: string): string | null {
		// Look for pattern: "Server output is being written to: /path/to/log"
		const match = errorMessage.match(/Server output is being written to:\s*(\S+)/);
		if (match && match[1]) {
			return match[1];
		}

		// Fallback: look for common log path patterns
		const fallbackMatch = errorMessage.match(/\/[^\s]+\/server\.log/);
		if (fallbackMatch) {
			return fallbackMatch[0];
		}

		return null;
	}

	/**
	 * Show server log from container in an output channel
	 */
	private async showServerLog(containerId: string, logPath: string): Promise<void> {
		try {
			this.logger.debug(`Reading server log from container: ${logPath}`);

			// Read log file from container
			const logContent = await this.readLogFileFromContainer(containerId, logPath);

			// Create output channel and show log content
			const outputChannel = vscode.window.createOutputChannel('Positron Server Installation Log');
			outputChannel.clear();
			outputChannel.appendLine(`Container: ${containerId}`);
			outputChannel.appendLine(`Log file: ${logPath}`);
			outputChannel.appendLine('='.repeat(80));
			outputChannel.appendLine('');
			outputChannel.append(logContent);
			outputChannel.show();

			this.logger.debug('Server log displayed successfully');
		} catch (error) {
			this.logger.error(`Failed to read server log from container: ${error}`);
			await vscode.window.showErrorMessage(
				vscode.l10n.t('Failed to read log file: {0}', error instanceof Error ? error.message : String(error))
			);
		}
	}

	/**
	 * Read log file from container using docker exec
	 */
	private async readLogFileFromContainer(containerId: string, logPath: string): Promise<string> {
		const config = getConfiguration();
		const dockerPath = config.getDockerPath();

		return new Promise((resolve, reject) => {
			const { spawn } = require('child_process');

			// Use cat to read the log file
			const command = `cat ${logPath} 2>/dev/null || echo "[Log file not found or not readable]"`;
			const args = ['exec', '-i', containerId, 'sh', '-c', command];

			this.logger.debug(`Reading log: ${dockerPath} ${args.join(' ')}`);

			const proc = spawn(dockerPath, args);

			let stdout = '';
			let stderr = '';

			proc.stdout.on('data', (data: Buffer) => {
				stdout += data.toString();
			});

			proc.stderr.on('data', (data: Buffer) => {
				stderr += data.toString();
			});

			proc.on('error', (error: Error) => {
				this.logger.error(`Failed to read log file from container: ${error.message}`);
				reject(error);
			});

			proc.on('close', (code: number) => {
				if (code === 0) {
					resolve(stdout);
				} else {
					const errorMsg = `Failed to read log file (exit code ${code})${stderr ? ': ' + stderr : ''}`;
					reject(new Error(errorMsg));
				}
			});
		});
	}

	/**
	 * Cleanup all resources
	 */
	dispose(): void {
		this.disconnectAll();
	}
}
