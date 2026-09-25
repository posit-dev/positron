/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as net from 'net';
import type Log from '../common/logger';
import { findRandomPort } from '../common/ports';
import SSHDestination from './sshDestination';
import SSHTransport, { SSHCommandResult, SSHTunnelConfig } from './sshTransport';

export interface NativeSSHConnectionOptions {
	executable: string;
	destination: SSHDestination;
	configFile?: string;
	connectTimeout: number;
	logger: Pick<Log, 'trace' | 'error'>;
}

type Tunnel = {
	config: SSHTunnelConfig;
	process: cp.ChildProcessWithoutNullStreams;
};

export default class NativeSSHConnection implements SSHTransport {
	private readonly tunnels = new Map<string, Tunnel>();
	private readonly commands = new Set<cp.ChildProcessWithoutNullStreams>();

	constructor(private readonly options: NativeSSHConnectionOptions) {
	}

	connect(): Promise<NativeSSHConnection> {
		// Commands and tunnels authenticate independently. Avoid an extra OpenSSH
		// invocation here, especially for configurations that mint certificates.
		return Promise.resolve(this);
	}

	exec(command: string, params?: string[]): Promise<SSHCommandResult> {
		return this.runCommand(this.appendParams(command, params));
	}

	execPartial(command: string, tester: (stdout: string, stderr: string) => boolean, params?: string[]): Promise<SSHCommandResult> {
		return this.runCommand(this.appendParams(command, params), tester);
	}

	async addTunnel(config: SSHTunnelConfig): Promise<SSHTunnelConfig> {
		const tunnelConfig = { ...config };
		tunnelConfig.localPort = tunnelConfig.localPort || await findRandomPort();
		tunnelConfig.name = tunnelConfig.name || `${tunnelConfig.remoteAddr}@${tunnelConfig.remotePort || tunnelConfig.remoteSocketPath}`;

		const existing = this.tunnels.get(tunnelConfig.name);
		if (existing) {
			return existing.config;
		}

		const forwardArgs = tunnelConfig.socks
			? ['-D', `127.0.0.1:${tunnelConfig.localPort}`]
			: ['-L', this.localForwardSpec(tunnelConfig)];
		const args = [
			...this.connectionArgs(),
			'-N',
			'-T',
			'-o', 'ExitOnForwardFailure=yes',
			...forwardArgs,
			this.target(),
		];

		this.options.logger.trace(`Spawning native SSH tunnel: ${this.options.executable} ${args.join(' ')}`);
		const child = cp.spawn(this.options.executable, args, { stdio: 'pipe', windowsHide: true });
		const tunnel = { config: tunnelConfig, process: child };
		this.tunnels.set(tunnelConfig.name, tunnel);

		try {
			await this.waitForTunnel(tunnel);
			child.once('close', (code, signal) => {
				if (this.tunnels.get(tunnelConfig.name!) === tunnel) {
					this.tunnels.delete(tunnelConfig.name!);
					const detail = signal ? `signal ${signal}` : `status ${code}`;
					this.options.logger.error(`Native SSH tunnel ${tunnelConfig.name} closed unexpectedly with ${detail}`);
				}
			});
			return tunnelConfig;
		} catch (error) {
			this.tunnels.delete(tunnelConfig.name);
			await this.stopProcess(child);
			throw error;
		}
	}

	async closeTunnel(name?: string): Promise<void> {
		if (name) {
			const tunnel = this.tunnels.get(name);
			if (!tunnel) {
				return;
			}
			this.tunnels.delete(name);
			await this.stopProcess(tunnel.process);
			return;
		}

		const names = [...this.tunnels.keys()];
		await Promise.all(names.map(tunnelName => this.closeTunnel(tunnelName)));
	}

	async close(): Promise<void> {
		await this.closeTunnel();
		const commands = [...this.commands];
		await Promise.all(commands.map(command => this.stopProcess(command)));
	}

	private appendParams(command: string, params?: string[]): string {
		return command + (params?.length ? ` ${params.join(' ')}` : '');
	}

	private runCommand(command: string, tester?: (stdout: string, stderr: string) => boolean): Promise<SSHCommandResult> {
		const args = [...this.connectionArgs(), '-T', this.target(), command];
		this.options.logger.trace(`Spawning native SSH command: ${this.options.executable} ${args.slice(0, -1).join(' ')}`);

		return new Promise((resolve, reject) => {
			const child = cp.spawn(this.options.executable, args, { stdio: 'pipe', windowsHide: true });
			this.commands.add(child);
			let stdout = '';
			let stderr = '';
			let settled = false;

			const finishPartial = () => {
				if (!settled && tester?.(stdout, stderr)) {
					settled = true;
					resolve({ stdout, stderr });
				}
			};

			child.stdout.on('data', data => {
				stdout += data.toString();
				finishPartial();
			});
			child.stderr.on('data', data => {
				stderr += data.toString();
				finishPartial();
			});
			child.once('error', error => {
				this.commands.delete(child);
				if (!settled) {
					settled = true;
					reject(error);
				}
			});
			child.once('close', (code, signal) => {
				this.commands.delete(child);
				if (settled) {
					return;
				}
				settled = true;
				if (code === 255) {
					reject(new Error(stderr.trim() || `OpenSSH exited with status ${code}`));
				} else if (signal) {
					reject(new Error(`OpenSSH was terminated by signal ${signal}`));
				} else {
					resolve({ stdout, stderr });
				}
			});
		});
	}

	private connectionArgs(): string[] {
		const args = ['-o', `ConnectTimeout=${this.options.connectTimeout}`];
		if (this.options.configFile) {
			args.push('-F', this.options.configFile);
		}
		if (this.options.destination.port) {
			args.push('-p', this.options.destination.port.toString());
		}
		return args;
	}

	private target(): string {
		return this.options.destination.user
			? `${this.options.destination.user}@${this.options.destination.hostname}`
			: this.options.destination.hostname;
	}

	private localForwardSpec(config: SSHTunnelConfig): string {
		if (config.remotePort) {
			return `127.0.0.1:${config.localPort}:${config.remoteAddr || '127.0.0.1'}:${config.remotePort}`;
		}
		if (config.remoteSocketPath) {
			return `127.0.0.1:${config.localPort}:${config.remoteSocketPath}`;
		}
		throw new Error('A native SSH tunnel requires a remote port or socket path');
	}

	private waitForTunnel(tunnel: Tunnel): Promise<void> {
		const timeoutMs = this.options.connectTimeout * 1000;
		return new Promise((resolve, reject) => {
			let stderr = '';
			let settled = false;
			let retry: NodeJS.Timeout | undefined;

			const finish = (error?: Error) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timeout);
				if (retry) {
					clearTimeout(retry);
				}
				tunnel.process.removeListener('error', onError);
				tunnel.process.removeListener('close', onClose);
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			};
			const onError = (error: Error) => finish(error);
			const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
				const detail = stderr.trim() || (signal ? `signal ${signal}` : `status ${code}`);
				finish(new Error(`OpenSSH tunnel exited before it became ready: ${detail}`));
			};
			const probe = () => {
				const socket = net.createConnection({ host: '127.0.0.1', port: tunnel.config.localPort! });
				socket.once('connect', () => {
					socket.destroy();
					finish();
				});
				socket.once('error', () => {
					socket.destroy();
					if (!settled) {
						retry = setTimeout(probe, 50);
					}
				});
			};

			tunnel.process.stderr.on('data', data => stderr += data.toString());
			tunnel.process.once('error', onError);
			tunnel.process.once('close', onClose);
			const timeout = setTimeout(() => finish(new Error(`Timed out waiting for native SSH tunnel on port ${tunnel.config.localPort}`)), timeoutMs);
			probe();
		});
	}

	private stopProcess(child: cp.ChildProcessWithoutNullStreams): Promise<void> {
		if (child.exitCode !== null || child.signalCode !== null) {
			return Promise.resolve();
		}
		return new Promise(resolve => {
			const timeout = setTimeout(() => {
				child.kill('SIGKILL');
				resolve();
			}, 1000);
			child.once('close', () => {
				clearTimeout(timeout);
				resolve();
			});
			child.kill();
		});
	}
}
