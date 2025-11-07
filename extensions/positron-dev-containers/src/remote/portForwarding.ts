/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as net from 'net';
import { Logger } from '../common/logger';

/**
 * Represents an active port forward
 */
export interface PortForward {
	containerId: string;
	remotePort: number;
	localPort: number;
	process?: cp.ChildProcess;
	server?: net.Server;
}

/**
 * Manages port forwarding between containers and localhost
 */
export class PortForwardingManager {
	private activeForwards = new Map<string, PortForward>();
	private logger: Logger;

	constructor(logger: Logger) {
		this.logger = logger;
	}

	/**
	 * Forward a port from a container to localhost
	 * @param containerId Container ID to forward from
	 * @param remotePort Port in the container
	 * @returns Local port number that is forwarding to the remote port
	 */
	async forwardPort(containerId: string, remotePort: number): Promise<number> {
		const forwardKey = `${containerId}:${remotePort}`;

		// Check if already forwarding
		const existing = this.activeForwards.get(forwardKey);
		if (existing) {
			this.logger.info(`Port forward already exists: ${existing.localPort} -> ${containerId}:${remotePort}`);
			return existing.localPort;
		}

		try {
			// Find available local port
			const localPort = await this.findAvailablePort();

			this.logger.info(`Setting up port forward: ${localPort} -> ${containerId}:${remotePort}`);

			// Create port forward using socat
			// socat is more reliable than `docker port` command for this use case
			const forward = await this.createPortForward(containerId, remotePort, localPort);

			this.activeForwards.set(forwardKey, forward);
			this.logger.info(`Port forward established: ${localPort} -> ${containerId}:${remotePort}`);

			return localPort;
		} catch (error) {
			this.logger.error(`Failed to forward port ${remotePort} from container ${containerId}`, error);
			throw error;
		}
	}

	/**
	 * Create a port forward using Docker's port forwarding capability
	 */
	private async createPortForward(
		containerId: string,
		remotePort: number,
		localPort: number
	): Promise<PortForward> {
		return new Promise((resolve, reject) => {
			// Create a TCP server that relays to the container
			// Try multiple approaches for maximum container compatibility

			const server = net.createServer((clientSocket) => {
				this.logger.debug(`New connection to forwarded port ${localPort}`);

				// Create connection to container using a fallback chain:
				// 1. Try bash with /dev/tcp (most efficient if bash is available)
				// 2. Try netcat (nc) if bash is not available
				// 3. Try socat as a last resort
				// Note: positron-server listens on ::1 (IPv6), so we use that instead of 127.0.0.1
				const portForwardCommand = `
					if command -v bash >/dev/null 2>&1; then
						exec bash -c 'exec 3<>/dev/tcp/::1/${remotePort}; cat <&3 & cat >&3; kill %1'
					elif command -v nc >/dev/null 2>&1; then
						exec nc ::1 ${remotePort}
					elif command -v socat >/dev/null 2>&1; then
						exec socat - TCP6:[::1]:${remotePort}
					else
						echo "ERROR: No suitable tool found for port forwarding (need bash, nc, or socat)" >&2
						exit 1
					fi
				`.trim();

				const dockerExec = cp.spawn('docker', [
					'exec',
					'-i',
					containerId,
					'sh',
					'-c',
					portForwardCommand
				]);

				// Pipe data bidirectionally
				clientSocket.pipe(dockerExec.stdin);
				dockerExec.stdout.pipe(clientSocket);

				dockerExec.stderr.on('data', (data) => {
					const errorText = data.toString();
					// Log errors for debugging
					if (errorText.trim().length > 0) {
						this.logger.debug(`Port forward stderr: ${errorText}`);
					}
				});

				clientSocket.on('error', (err) => {
					this.logger.debug(`Client socket error: ${err.message}`);
					dockerExec.kill();
				});

				clientSocket.on('close', () => {
					this.logger.debug(`Client disconnected from port ${localPort}`);
					dockerExec.kill();
				});

				dockerExec.on('exit', (code) => {
					if (code !== 0 && code !== null) {
						this.logger.debug(`Port forward process exited with code ${code}`);
					}
					clientSocket.end();
				});
			});

			server.on('error', (err) => {
				reject(err);
			});

			server.listen(localPort, '127.0.0.1', () => {
				this.logger.debug(`Port forward server listening on ${localPort}`);
				resolve({
					containerId,
					remotePort,
					localPort,
					process: undefined,
					server: server // Track the server so we can close it later
				});
			});
		});
	}

	/**
	 * Stop a port forward
	 */
	async stopPortForward(containerId: string, remotePort: number): Promise<void> {
		const forwardKey = `${containerId}:${remotePort}`;
		const forward = this.activeForwards.get(forwardKey);

		if (!forward) {
			this.logger.debug(`No port forward found for ${forwardKey}`);
			return;
		}

		this.logger.info(`Stopping port forward: ${forward.localPort} -> ${containerId}:${remotePort}`);

		if (forward.process) {
			forward.process.kill();
		}

		if (forward.server) {
			forward.server.close();
		}

		this.activeForwards.delete(forwardKey);
	}

	/**
	 * Stop all port forwards for a container
	 */
	async stopAllForContainer(containerId: string): Promise<void> {
		const forwards = Array.from(this.activeForwards.values())
			.filter(f => f.containerId === containerId);

		for (const forward of forwards) {
			await this.stopPortForward(forward.containerId, forward.remotePort);
		}
	}

	/**
	 * Stop all port forwards
	 */
	async stopAll(): Promise<void> {
		const forwards = Array.from(this.activeForwards.values());
		for (const forward of forwards) {
			await this.stopPortForward(forward.containerId, forward.remotePort);
		}
	}

	/**
	 * Get all active port forwards
	 */
	getActiveForwards(): PortForward[] {
		return Array.from(this.activeForwards.values());
	}

	/**
	 * Find an available local port
	 */
	private async findAvailablePort(startPort: number = 10000): Promise<number> {
		return new Promise((resolve, reject) => {
			const server = net.createServer();

			server.on('error', (err: NodeJS.ErrnoException) => {
				if (err.code === 'EADDRINUSE') {
					// Port in use, try next one
					resolve(this.findAvailablePort(startPort + 1));
				} else {
					reject(err);
				}
			});

			server.listen(startPort, '127.0.0.1', () => {
				const port = (server.address() as net.AddressInfo).port;
				server.close(() => {
					resolve(port);
				});
			});
		});
	}

	/**
	 * Check if a port forward is active
	 */
	isPortForwarded(containerId: string, remotePort: number): boolean {
		const forwardKey = `${containerId}:${remotePort}`;
		return this.activeForwards.has(forwardKey);
	}

	/**
	 * Get the local port for a forwarded remote port
	 */
	getLocalPort(containerId: string, remotePort: number): number | undefined {
		const forwardKey = `${containerId}:${remotePort}`;
		return this.activeForwards.get(forwardKey)?.localPort;
	}

	/**
	 * Cleanup all resources
	 */
	dispose(): void {
		this.stopAll();
	}
}
