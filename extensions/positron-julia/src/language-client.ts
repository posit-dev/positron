/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';

import { LOGGER } from './extension';
import { JuliaInstallation } from './julia-installation';

/**
 * Manages the Julia Language Server client.
 */
export class JuliaLanguageClient implements vscode.Disposable {

	private _client: LanguageClient | undefined;
	private _installation: JuliaInstallation | undefined;
	private _extensionPath: string;
	private _outputChannel: vscode.OutputChannel;

	constructor(extensionPath: string) {
		this._extensionPath = extensionPath;
		this._outputChannel = vscode.window.createOutputChannel('Julia Language Server');
	}

	/**
	 * Returns the path to the language server depot for a specific Julia version.
	 * Each Julia minor version gets its own depot to avoid compatibility issues.
	 *
	 * @param installation The Julia installation to get the depot path for
	 */
	private getLsDepotPath(installation: JuliaInstallation): string {
		// Use minor version (1.10, 1.12, etc.) for depot isolation
		const versionMatch = installation.version.match(/^(\d+\.\d+)/);
		const minorVersion = versionMatch ? versionMatch[1] : '1.x';
		return path.join(this._extensionPath, 'lsdepot', `v${minorVersion}`);
	}

	/**
	 * Checks if LanguageServer.jl is installed in the depot for this Julia version.
	 */
	private isLanguageServerInstalled(installation: JuliaInstallation): boolean {
		const depotPath = this.getLsDepotPath(installation);
		// Check if the environment directory exists with a Manifest.toml
		const envPath = path.join(depotPath, 'environments', `v${installation.version.match(/^(\d+\.\d+)/)?.[1] || '1.x'}`);
		const manifestPath = path.join(envPath, 'Manifest.toml');
		return fs.existsSync(manifestPath);
	}

	/**
	 * Installs LanguageServer.jl into the extension's depot.
	 */
	private async installLanguageServer(installation: JuliaInstallation): Promise<void> {
		const depotPath = this.getLsDepotPath(installation);

		// Ensure depot directory exists
		fs.mkdirSync(depotPath, { recursive: true });

		const installScript = path.join(
			this._extensionPath,
			'scripts',
			'languageserver',
			'install.jl'
		);

		LOGGER.info(`Installing Julia Language Server to ${depotPath}`);

		return vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Installing Julia Language Server...',
			cancellable: false
		}, async (progress) => {
			progress.report({ message: 'This may take a few minutes on first run' });

			return new Promise<void>((resolve, reject) => {
				const proc = cp.spawn(installation.binpath, [
					'--startup-file=no',
					'--history-file=no',
					'--project=@.',
					installScript
				], {
					env: {
						...process.env,
						JULIA_DEPOT_PATH: depotPath,
					}
				});

				let stdout = '';
				let stderr = '';

				proc.stdout.on('data', (data) => {
					stdout += data.toString();
					LOGGER.debug(`[LS Install] ${data.toString().trim()}`);
				});

				proc.stderr.on('data', (data) => {
					stderr += data.toString();
					LOGGER.debug(`[LS Install stderr] ${data.toString().trim()}`);
				});

				proc.on('close', (code) => {
					if (code === 0) {
						LOGGER.info('Julia Language Server installed successfully');
						resolve();
					} else {
						const error = new Error(`Installation failed with code ${code}: ${stderr}`);
						LOGGER.error(`Failed to install Language Server: ${error.message}`);
						reject(error);
					}
				});

				proc.on('error', (error) => {
					LOGGER.error(`Failed to spawn installation process: ${error.message}`);
					reject(error);
				});
			});
		});
	}

	/**
	 * Starts the language server with the given Julia installation.
	 * Automatically installs LanguageServer.jl if not present.
	 */
	async start(installation: JuliaInstallation): Promise<void> {
		if (this._client) {
			LOGGER.info('Language server already running');
			return;
		}

		this._installation = installation;

		// Check if LanguageServer.jl is installed for this Julia version, install if not
		if (!this.isLanguageServerInstalled(installation)) {
			try {
				await this.installLanguageServer(installation);
			} catch (error) {
				LOGGER.error(`Failed to install Language Server: ${error}`);
				vscode.window.showWarningMessage(
					'Failed to install Julia Language Server. Code completion may not be available.'
				);
				return;
			}
		}

		LOGGER.info(`Starting Julia Language Server with ${installation.binpath}`);

		// Path to the language server main script
		const serverScript = path.join(
			this._extensionPath,
			'scripts',
			'languageserver',
			'main.jl'
		);

		// Get the workspace folder for the environment path
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

		// Language server depot path - version-specific to support multiple Julia versions
		const lsDepot = this.getLsDepotPath(installation);

		// Server options - spawn Julia process
		const serverOptions: ServerOptions = {
			command: installation.binpath,
			args: [
				'--startup-file=no',
				'--history-file=no',
				'--depwarn=no',
				serverScript,
				workspaceFolder
			],
			options: {
				env: {
					...process.env,
					JULIA_DEPOT_PATH: lsDepot,
					JULIA_LOAD_PATH: path.delimiter,  // Empty load path, only use depot
					JULIA_LANGUAGESERVER: '1',
					POSITRON_JULIA_LS: '1',
				}
			},
			transport: TransportKind.stdio
		};

		// Client options
		const clientOptions: LanguageClientOptions = {
			documentSelector: [
				{ scheme: 'file', language: 'julia' },
				{ scheme: 'untitled', language: 'julia' },
				{ scheme: 'vscode-notebook-cell', language: 'julia' },
				{ scheme: 'inmemory', language: 'julia' },  // Console
			],
			synchronize: {
				fileEvents: [
					vscode.workspace.createFileSystemWatcher('**/*.jl'),
					vscode.workspace.createFileSystemWatcher('**/Project.toml'),
					vscode.workspace.createFileSystemWatcher('**/Manifest.toml'),
				]
			},
			outputChannel: this._outputChannel,
			traceOutputChannel: this._outputChannel,
		};

		// Create and start the client
		this._client = new LanguageClient(
			'juliaLanguageServer',
			'Julia Language Server',
			serverOptions,
			clientOptions
		);

		try {
			await this._client.start();
			LOGGER.info('Julia Language Server started successfully');
		} catch (error) {
			LOGGER.error(`Failed to start Julia Language Server: ${error}`);
			this._client = undefined;
			throw error;
		}
	}

	/**
	 * Stops the language server.
	 */
	async stop(): Promise<void> {
		if (this._client) {
			LOGGER.info('Stopping Julia Language Server');
			await this._client.stop();
			this._client = undefined;
		}
	}

	/**
	 * Restarts the language server.
	 */
	async restart(): Promise<void> {
		if (this._installation) {
			await this.stop();
			await this.start(this._installation);
		}
	}

	/**
	 * Returns whether the language server is running.
	 */
	isRunning(): boolean {
		return this._client !== undefined && this._client.isRunning();
	}

	dispose(): void {
		this.stop();
		this._outputChannel.dispose();
	}
}
