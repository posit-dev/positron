/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { EnvironmentType, virtualEnvTypes } from '../pythonEnvironments/info';
import { IInterpreterService } from '../interpreter/contracts';
import { IServiceContainer } from '../ioc/types';

/**
 * Interface for emitting messages to the Positron console
 */
interface MessageEmitter {
	fire(message: positron.LanguageRuntimeMessage): void;
}

/**
 * Pip Package Manager
 *
 * Provides package management functionality for Python sessions using pip.
 * Runs pip commands as subprocesses and streams output to the Positron Console.
 */
export class PipPackageManager {
	constructor(
		private readonly _pythonPath: string,
		private readonly _messageEmitter: MessageEmitter,
		private readonly _serviceContainer: IServiceContainer,
	) { }

	/**
	 * Check if pip is available in the current Python environment.
	 */
	async isPipAvailable(): Promise<boolean> {
		try {
			const result = await this._executePipCommand(['-m', 'pip', '--version'], { capture: true });
			return result.exitCode === 0;
		} catch {
			return false;
		}
	}

	/**
	 * Install one or more packages.
	 * Supports specifying versions with == syntax (e.g., "package==1.0.0").
	 */
	async installPackages(packages: string[]): Promise<void> {
		if (packages.length === 0) {
			return;
		}

		await this._ensurePip();

		const flags = await this._getInstallFlags();
		const args = ['-m', 'pip', 'install', ...flags, ...packages];

		await this._executePipCommandWithRetry(args);
	}

	/**
	 * Uninstall one or more packages.
	 */
	async uninstallPackages(packages: string[]): Promise<void> {
		if (packages.length === 0) {
			return;
		}

		await this._ensurePip();

		const args = ['-m', 'pip', 'uninstall', '-y', ...packages];

		await this._executePipCommandWithOutput(args);
	}

	/**
	 * Update specific packages to latest versions.
	 * Supports specifying versions with == syntax (e.g., "package==1.0.0").
	 */
	async updatePackages(packages: string[]): Promise<void> {
		if (packages.length === 0) {
			return;
		}

		await this._ensurePip();

		const flags = await this._getInstallFlags();
		const args = ['-m', 'pip', 'install', '--upgrade', ...flags, ...packages];

		await this._executePipCommandWithRetry(args);
	}

	/**
	 * Update all installed packages to their latest versions.
	 */
	async updateAllPackages(): Promise<void> {
		await this._ensurePip();

		// First, get list of outdated packages
		const outdatedResult = await this._executePipCommand(
			['-m', 'pip', 'list', '--outdated', '--format=json'],
			{ capture: true }
		);

		if (outdatedResult.exitCode !== 0) {
			throw new Error('Failed to get list of outdated packages');
		}

		let outdatedPackages: Array<{ name: string }> = [];
		try {
			outdatedPackages = JSON.parse(outdatedResult.stdout);
		} catch {
			throw new Error('Failed to parse outdated packages list');
		}

		if (outdatedPackages.length === 0) {
			this._emitMessage('All packages are up to date.\n');
			return;
		}

		const packageNames = outdatedPackages.map(pkg => pkg.name);
		const flags = await this._getInstallFlags();
		const args = ['-m', 'pip', 'install', '--upgrade', ...flags, ...packageNames];

		await this._executePipCommandWithRetry(args);
	}

	// =========================================================================
	// Private helper methods
	// =========================================================================

	/**
	 * Ensure pip is available, throwing an error if not.
	 */
	private async _ensurePip(): Promise<void> {
		const hasPip = await this.isPipAvailable();
		if (!hasPip) {
			throw new Error(
				'pip is not available in this Python environment. ' +
				'Please install pip to use package management features.'
			);
		}
	}

	/**
	 * Get installation flags based on the Python environment type.
	 * Auto-detects when --user flag is needed.
	 */
	private async _getInstallFlags(): Promise<string[]> {
		const flags: string[] = [];

		// Add proxy if configured
		const proxy = vscode.workspace.getConfiguration('http').get<string>('proxy', '');
		if (proxy) {
			flags.push('--proxy', proxy);
		}

		// Check if we need the --user flag for system Python
		const interpreterService = this._serviceContainer.get<IInterpreterService>(IInterpreterService);
		const interpreter = await interpreterService.getInterpreterDetails(this._pythonPath);

		if (interpreter) {
			// Don't use --user for virtual environments or conda environments
			if (!virtualEnvTypes.includes(interpreter.envType) && interpreter.envType !== EnvironmentType.Conda) {
				// For system Python (Unknown type), use --user flag
				if (interpreter.envType === EnvironmentType.Unknown) {
					flags.push('--user');
				}
			}
		}

		return flags;
	}

	/**
	 * Execute a pip command with retry for externally-managed environments.
	 * If the command fails with an externally-managed-environment error,
	 * retry with --break-system-packages flag.
	 */
	private async _executePipCommandWithRetry(args: string[]): Promise<void> {
		try {
			await this._executePipCommandWithOutput(args);
		} catch (error) {
			if (error instanceof Error && error.message.includes('externally-managed-environment')) {
				// Retry with --break-system-packages flag
				this._emitMessage(
					'\nRetrying with --break-system-packages flag for externally-managed environment...\n'
				);
				const retryArgs = [...args];
				// Insert the flag after 'install'
				const installIndex = retryArgs.indexOf('install');
				if (installIndex !== -1) {
					retryArgs.splice(installIndex + 1, 0, '--break-system-packages');
				}
				await this._executePipCommandWithOutput(retryArgs);
			} else {
				throw error;
			}
		}
	}

	/**
	 * Execute a pip command and stream output to the console.
	 */
	private async _executePipCommandWithOutput(args: string[]): Promise<void> {
		const id = randomUUID();

		// Emit the command being executed
		this._emitMessage(`\x1b[90m$ python ${args.join(' ')}\x1b[0m\n`, id);

		return new Promise<void>((resolve, reject) => {
			const childProc = spawn(this._pythonPath, args, {
				shell: false,
			});

			let stderrOutput = '';

			childProc.stdout?.on('data', (data: Buffer) => {
				this._emitMessage(data.toString(), id);
			});

			childProc.stderr?.on('data', (data: Buffer) => {
				const text = data.toString();
				stderrOutput += text;
				this._emitMessage(text, id);
			});

			childProc.on('error', (error: Error) => {
				reject(error);
			});

			childProc.on('close', (code: number | null) => {
				// Emit idle state
				this._emitState(positron.RuntimeOnlineState.Idle, id);

				if (code === 0) {
					resolve();
				} else {
					// Check for externally-managed-environment error
					if (stderrOutput.includes('externally-managed-environment')) {
						reject(new Error('externally-managed-environment: ' + stderrOutput));
					} else {
						reject(new Error(`pip command failed with exit code ${code}`));
					}
				}
			});
		});
	}

	/**
	 * Execute a pip command and capture output (not streamed to console).
	 */
	private async _executePipCommand(
		args: string[],
		_options: { capture: boolean }
	): Promise<{ exitCode: number; stdout: string; stderr: string }> {
		return new Promise((resolve, reject) => {
			const proc = spawn(this._pythonPath, args, {
				shell: false,
			});

			let stdout = '';
			let stderr = '';

			proc.stdout?.on('data', (data: Buffer) => {
				stdout += data.toString();
			});

			proc.stderr?.on('data', (data: Buffer) => {
				stderr += data.toString();
			});

			proc.on('error', (error: Error) => {
				reject(error);
			});

			proc.on('close', (code: number | null) => {
				resolve({
					exitCode: code ?? 1,
					stdout,
					stderr,
				});
			});
		});
	}

	/**
	 * Emit a stream message to the console.
	 */
	private _emitMessage(text: string, parentId?: string): void {
		this._messageEmitter.fire({
			id: randomUUID(),
			parent_id: parentId ?? '',
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Stream,
			name: positron.LanguageRuntimeStreamName.Stdout,
			text,
		} as positron.LanguageRuntimeStream);
	}

	/**
	 * Emit a state change message.
	 */
	private _emitState(state: positron.RuntimeOnlineState, parentId: string): void {
		this._messageEmitter.fire({
			id: randomUUID(),
			parent_id: parentId,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.State,
			state,
		} as positron.LanguageRuntimeState);
	}
}
