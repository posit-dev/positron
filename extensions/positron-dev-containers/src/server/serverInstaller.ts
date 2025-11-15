/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getLogger } from '../common/logger';
import { getConfiguration } from '../common/configuration';
import { ServerConfig, ServerConfigProvider, getServerConfigProvider } from './serverConfig';
import { generateConnectionToken, revokeConnectionToken } from './connectionToken';
import { generateInstallScript, parseInstallScriptOutput, InstallScriptOptions } from './installScript';

/**
 * Server installation options
 */
export interface ServerInstallOptions {
	/**
	 * Container ID to install server in
	 */
	containerId: string;

	/**
	 * Whether to force reinstallation even if already installed
	 */
	forceReinstall?: boolean;

	/**
	 * Port to listen on (0 for random port)
	 */
	port?: number;

	/**
	 * Use socket instead of port
	 */
	useSocket?: boolean;

	/**
	 * Socket path (if useSocket is true)
	 */
	socketPath?: string;

	/**
	 * Extensions to install
	 */
	extensions?: string[];

	/**
	 * Additional server arguments
	 */
	additionalArgs?: string[];

	/**
	 * Progress reporter
	 */
	progress?: vscode.Progress<{ message?: string; increment?: number }>;

	/**
	 * Environment variables to set for the server process
	 */
	extensionHostEnv?: { [key: string]: string };
}

/**
 * Server installation result
 */
export interface ServerInstallResult {
	/**
	 * Container ID
	 */
	containerId: string;

	/**
	 * Connection token
	 */
	connectionToken: string;

	/**
	 * Port or socket path server is listening on
	 */
	listeningOn: string;

	/**
	 * Whether listening on a port (vs socket)
	 */
	isPort: boolean;

	/**
	 * Port number (if isPort is true)
	 */
	port?: number;

	/**
	 * Socket path (if isPort is false)
	 */
	socketPath?: string;

	/**
	 * Server process ID in container
	 */
	serverPid: string;

	/**
	 * Server configuration used
	 */
	serverConfig: ServerConfig;
}

/**
 * Container platform information
 */
interface ContainerPlatformInfo {
	platform: string;
	arch: string;
	osRelease?: string;
}

/**
 * Server installer
 * Handles installation and startup of the Positron server in containers
 */
export class ServerInstaller {
	private static instance: ServerInstaller;
	private logger = getLogger();
	private serverConfigProvider: ServerConfigProvider;

	private constructor() {
		this.serverConfigProvider = getServerConfigProvider();
	}

	/**
	 * Get the singleton instance
	 */
	public static getInstance(): ServerInstaller {
		if (!ServerInstaller.instance) {
			ServerInstaller.instance = new ServerInstaller();
		}
		return ServerInstaller.instance;
	}

	/**
	 * Install and start the Positron server in a container
	 * @param options Installation options
	 * @returns Server installation result
	 */
	public async installAndStartServer(options: ServerInstallOptions): Promise<ServerInstallResult> {
		const { containerId, progress } = options;

		this.logger.info(`Installing Positron server in container ${containerId}`);

		try {
			// Step 1: Detect container platform
			progress?.report({ message: 'Detecting container platform...', increment: 10 });
			const platformInfo = await this.detectContainerPlatform(containerId);
			this.logger.debug(`Container platform: ${platformInfo.platform}-${platformInfo.arch}`);

			// Step 2: Get server configuration for container platform
			progress?.report({ message: 'Preparing server configuration...', increment: 10 });
			const serverConfig = this.serverConfigProvider.getServerConfigForContainer(
				platformInfo.platform,
				platformInfo.arch
			);

			// Step 3: Generate connection token
			const connectionToken = generateConnectionToken(containerId);

			// Step 4: Get extensions to install
			const config = getConfiguration();
			const extensions = options.extensions || config.getDefaultExtensions();

			// Step 5: Generate installation script
			progress?.report({ message: 'Generating installation script...', increment: 10 });
			const scriptOptions: InstallScriptOptions = {
				serverConfig,
				connectionToken,
				port: options.port,
				useSocket: options.useSocket,
				socketPath: options.socketPath,
				extensions,
				additionalArgs: options.additionalArgs,
				skipStart: false,
				extensionHostEnv: options.extensionHostEnv
			};

			const installScript = generateInstallScript(scriptOptions);
			this.logger.debug('Installation script generated');

			// Step 6: Execute installation script in container
			progress?.report({ message: 'Installing server in container...', increment: 30 });
			const scriptOutput = await this.executeInstallScript(containerId, installScript);

			// Step 7: Parse output
			progress?.report({ message: 'Verifying installation...', increment: 20 });
			const parsedOutput = parseInstallScriptOutput(scriptOutput);

			if (!parsedOutput) {
				throw new Error('Failed to parse installation script output. Server may not have started correctly.');
			}

			if (parsedOutput.exitCode !== 0) {
				throw new Error(`Server installation failed with exit code ${parsedOutput.exitCode}`);
			}

			// Step 8: Build result
			progress?.report({ message: 'Server installed successfully', increment: 20 });

			const isPort = !options.useSocket;
			const result: ServerInstallResult = {
				containerId,
				connectionToken: parsedOutput.connectionToken,
				listeningOn: parsedOutput.listeningOn,
				isPort,
				port: isPort ? parseInt(parsedOutput.listeningOn, 10) : undefined,
				socketPath: isPort ? undefined : parsedOutput.listeningOn,
				serverPid: parsedOutput.serverPid,
				serverConfig
			};

			this.logger.info(`Server installed successfully in container ${containerId}, listening on ${result.listeningOn}`);

			return result;

		} catch (error) {
			this.logger.error(`Failed to install server in container ${containerId}: ${error}`);
			// Revoke the token if installation failed
			try {
				revokeConnectionToken(containerId);
			} catch (revokeError) {
				this.logger.warn(`Failed to revoke connection token: ${revokeError}`);
			}
			throw error;
		}
	}

	/**
	 * Check if server is already installed in a container
	 * @param containerId Container ID
	 * @returns True if server is installed, false otherwise
	 */
	public async isServerInstalled(containerId: string): Promise<boolean> {
		try {
			const serverConfig = this.serverConfigProvider.getServerConfig();
			const installPath = this.serverConfigProvider.getServerInstallPath(serverConfig);
			const serverBinary = `${installPath}/bin/positron-server`;

			// Check if server binary exists
			const checkCommand = `test -f ${serverBinary} && echo "exists" || echo "not-exists"`;
			const output = await this.executeCommandInContainer(containerId, checkCommand);

			return output.trim() === 'exists';
		} catch (error) {
			this.logger.warn(`Failed to check if server is installed in container ${containerId}: ${error}`);
			return false;
		}
	}

	/**
	 * Detect the platform and architecture of a container
	 * @param containerId Container ID
	 * @returns Platform information
	 */
	private async detectContainerPlatform(containerId: string): Promise<ContainerPlatformInfo> {
		// Run uname commands to detect platform
		const detectScript = `
			echo "platform=$(uname -s | tr '[:upper:]' '[:lower:]')"
			echo "arch=$(uname -m)"
			if [ -f /etc/os-release ]; then
				echo "osRelease=$(cat /etc/os-release | grep '^ID=' | cut -d= -f2 | tr -d '"')"
			fi
		`;

		const output = await this.executeCommandInContainer(containerId, detectScript);

		// Parse output
		const platformInfo: Partial<ContainerPlatformInfo> = {};

		const lines = output.split('\n');
		for (const line of lines) {
			const [key, value] = line.split('=', 2);
			if (key && value) {
				switch (key.trim()) {
					case 'platform':
						// Normalize platform name
						const platform = value.trim();
						if (platform === 'linux') {
							platformInfo.platform = 'linux';
						} else if (platform === 'darwin') {
							platformInfo.platform = 'darwin';
						} else {
							// Default to linux for unknown platforms
							platformInfo.platform = 'linux';
						}
						break;
					case 'arch':
						platformInfo.arch = value.trim();
						break;
					case 'osRelease':
						platformInfo.osRelease = value.trim();
						break;
				}
			}
		}

		if (!platformInfo.platform || !platformInfo.arch) {
			throw new Error(`Failed to detect container platform. Output: ${output}`);
		}

		return platformInfo as ContainerPlatformInfo;
	}

	/**
	 * Execute the installation script in a container
	 * @param containerId Container ID
	 * @param script Script content
	 * @returns Script output
	 */
	private async executeInstallScript(containerId: string, script: string): Promise<string> {
		// Write script to a temp file in container and execute it
		// We use a multi-step approach:
		// 1. Write script content to stdin
		// 2. Pipe to sh (more compatible than bash)

		const command = `sh -c ${this.escapeShellArg(script)}`;

		this.logger.debug(`Executing installation script in container ${containerId}`);

		try {
			const output = await this.executeCommandInContainer(containerId, command);
			return output;
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			this.logger.error(`Installation script execution failed: ${errorMsg}`);
			// Preserve the detailed error message from executeCommandInContainer
			throw new Error(`Installation script failed: ${errorMsg}`);
		}
	}

	/**
	 * Execute a command in a container using docker exec
	 * This is a simplified version that directly uses docker CLI
	 * @param containerId Container ID
	 * @param command Command to execute
	 * @returns Command output
	 */
	private async executeCommandInContainer(containerId: string, command: string): Promise<string> {
		const config = getConfiguration();
		const dockerPath = config.getDockerPath();

		return new Promise((resolve, reject) => {
			const { spawn } = require('child_process');

			// Build the command args
			const args = ['exec', '-i', containerId, 'sh', '-c', command];
			this.logger.debug(`Executing: ${dockerPath} ${args.join(' ')}`);

			const proc = spawn(dockerPath, args);

			let stdout = '';
			let stderr = '';
			let lastProgressLog = 0;
			const PROGRESS_LOG_INTERVAL = 1000; // Log progress at most once per second

			// Stream stdout to logger in real-time
			proc.stdout.on('data', (data: Buffer) => {
				const text = data.toString();
				stdout += text;
				// Stream to output channel - split by lines for cleaner output
				text.split('\n').filter(line => line.trim()).forEach(line => {
					// Filter out download progress lines that contain percentage or are very repetitive
					const isProgressLine = /\d+%|####|===|\.\.\./.test(line) || line.length > 200;

					if (isProgressLine) {
						// Only log progress lines occasionally to avoid spam
						const now = Date.now();
						if (now - lastProgressLog > PROGRESS_LOG_INTERVAL) {
							this.logger.debug(`[Container] ${line.substring(0, 100)}...`);
							lastProgressLog = now;
						}
					} else {
						// Log non-progress lines normally
						this.logger.debug(`[Container] ${line}`);
					}
				});
			});

			// Stream stderr to logger in real-time
			proc.stderr.on('data', (data: Buffer) => {
				const text = data.toString();
				stderr += text;
				// Stream to output channel
				text.split('\n').filter(line => line.trim()).forEach(line => {
					// Use info level for script output (scripts use stderr for normal logging)
					// Actual errors will be caught by the exit code and error handling
					this.logger.debug(`[Container] ${line}`);
				});
			});

			proc.on('error', (error: Error) => {
				this.logger.error(`Failed to execute command in container ${containerId}: ${error.message}`);
				reject(error);
			});

			proc.on('close', (code: number) => {
				if (code === 0) {
					resolve(stdout);
				} else {
					const errorMsg = `Command exited with code ${code}`;
					this.logger.error(errorMsg);
					if (stderr) {
						this.logger.error(`stderr: ${stderr}`);
					}
					// Create a more descriptive error by extracting context from stderr/stdout
					const errorContext = this.extractErrorContext(stderr, stdout);
					reject(new Error(`${errorMsg}${errorContext ? ': ' + errorContext : ''}`));
				}
			});
		});
	}

	/**
	 * Extract meaningful error context from command output
	 */
	private extractErrorContext(stderr: string, stdout: string): string {
		// Look for ERROR: lines in stdout/stderr
		const errorLines = (stdout + '\n' + stderr)
			.split('\n')
			.filter(line => line.includes('ERROR:'))
			.map(line => line.replace(/^.*ERROR:\s*/, '').trim())
			.filter(line => line.length > 0);

		if (errorLines.length > 0) {
			return errorLines[0];
		}

		// Look for common error patterns
		const lastLines = (stderr || stdout).split('\n').filter(l => l.trim()).slice(-5);
		if (lastLines.length > 0) {
			return lastLines[lastLines.length - 1].substring(0, 200);
		}

		return '';
	}

	/**
	 * Escape a string for use as a shell argument
	 * @param arg Argument to escape
	 * @returns Escaped argument
	 */
	private escapeShellArg(arg: string): string {
		// Escape single quotes by replacing them with '\''
		return `'${arg.replace(/'/g, `'\\''`)}'`;
	}

	/**
	 * Stop the server in a container
	 * @param containerId Container ID
	 * @param serverPid Server process ID
	 */
	public async stopServer(containerId: string, serverPid: string): Promise<void> {
		try {
			this.logger.info(`Stopping server (PID ${serverPid}) in container ${containerId}`);

			// Send SIGTERM to the server process
			const killCommand = `kill -TERM ${serverPid}`;
			await this.executeCommandInContainer(containerId, killCommand);

			// Wait a bit for graceful shutdown
			await new Promise(resolve => setTimeout(resolve, 2000));

			// Check if process is still running
			const checkCommand = `kill -0 ${serverPid} 2>/dev/null && echo "running" || echo "stopped"`;
			const status = await this.executeCommandInContainer(containerId, checkCommand);

			if (status.trim() === 'running') {
				// Force kill if still running
				this.logger.warn(`Server did not stop gracefully, force killing...`);
				const forceKillCommand = `kill -KILL ${serverPid}`;
				await this.executeCommandInContainer(containerId, forceKillCommand);
			}

			this.logger.info(`Server stopped successfully in container ${containerId}`);
		} catch (error) {
			this.logger.error(`Failed to stop server in container ${containerId}: ${error}`);
			throw error;
		}
	}
}

/**
 * Get server installer instance
 */
export function getServerInstaller(): ServerInstaller {
	return ServerInstaller.getInstance();
}

/**
 * Install and start server in a container
 * @param options Installation options
 * @returns Installation result
 */
export async function installAndStartServer(options: ServerInstallOptions): Promise<ServerInstallResult> {
	return getServerInstaller().installAndStartServer(options);
}

/**
 * Check if server is installed in a container
 * @param containerId Container ID
 * @returns True if installed
 */
export async function isServerInstalled(containerId: string): Promise<boolean> {
	return getServerInstaller().isServerInstalled(containerId);
}

/**
 * Stop server in a container
 * @param containerId Container ID
 * @param serverPid Server process ID
 */
export async function stopServer(containerId: string, serverPid: string): Promise<void> {
	return getServerInstaller().stopServer(containerId, serverPid);
}
