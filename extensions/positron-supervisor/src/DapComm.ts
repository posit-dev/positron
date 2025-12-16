/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { JupyterLanguageRuntimeSession, Comm } from './positron-supervisor';

/**
 * A Debug Adapter Protocol (DAP) comm.
 * See `positron-supervisor.d.ts` for documentation.
 */
export class DapComm {
	public get comm(): Comm | undefined {
		return this._comm;
	}
	public get port(): number | undefined {
		return this._port;
	}

	private _comm?: Comm;
	private _port?: number;
	private _debugSession?: vscode.DebugSession;
	private _startingSession?: Promise<void>;
	private connected = false;
	private messageCounter = 0;
	private msgStem: string;
	private disposables: vscode.Disposable[] = [];

	private config?: vscode.DebugConfiguration;
	private debugOptions?: vscode.DebugSessionOptions;

	constructor(
		private session: JupyterLanguageRuntimeSession,
		readonly targetName: string,
		readonly debugType: string,
		readonly debugName: string,
	) {

		// Generate 8 random hex characters for the message stem
		this.msgStem = Math.random().toString(16).slice(2, 10);
	}

	async createComm(): Promise<void> {
		// NOTE: Ideally we'd allow connecting to any network interface but the
		// `debugServer` property passed in the configuration below needs to be
		// localhost.
		const host = '127.0.0.1';

		const [comm, serverPort] = await this.session.createServerComm(this.targetName, host);

		this._comm = comm;
		this._port = serverPort;

		this.session.emitJupyterLog(`Starting debug session for DAP server ${this.comm!.id}`);

		this.config = {
			type: this.debugType,
			name: this.debugName,
			request: 'attach',
			debugServer: this.port,
			internalConsoleOptions: 'neverOpen',
		};

		this.debugOptions = {
			suppressDebugToolbar: true,
		};

		// Reconnect sessions automatically as long as we are "connected"
		this.register(vscode.debug.onDidTerminateDebugSession(async (session) => {
			if (session !== this._debugSession) {
				return;
			}

			this._debugSession = undefined;

			if (!this.connected) {
				return;
			}

			try {
				await this.connect();
			} catch (err) {
				this.session.emitJupyterLog(
					`Failed to reconnect debug session: ${err}`,
					vscode.LogLevel.Warning
				);
			}
		}));
	}

	async connect() {
		if (!this.config) {
			throw new Error('Comm must be created before connecting');
		}

		this.connected = true;

		if (this._debugSession) {
			return;
		}
		if (this._startingSession) {
			return this._startingSession;
		}

		this._startingSession = (async () => {
			this._debugSession = await this.startDebugSession();
			this._startingSession = undefined;
		})();

		return this._startingSession;
	}

	async disconnect() {
		const session = this._debugSession;

		this.connected = false;
		this._debugSession = undefined;

		if (!session) {
			return;
		}
		await vscode.debug.stopDebugging(session);
	}

	private debugSession(): vscode.DebugSession {
		if (!this._debugSession) {
			// We could try to reconnect here if session proves unstable for users
			throw new Error('Debug session not initialized');
		}
		return this._debugSession;
	}

	async handleMessage(msg: any): Promise<boolean> {
		if (msg.kind === 'request') {
			return false;
		}

		switch (msg.method) {
			// The runtime is in control of when to start a debug session.
			// When this happens, we attach automatically to the runtime
			// with a synthetic configuration.
			case 'start_debug': {
				vscode.debug.setSuppressDebugToolbar(this.debugSession(), false);
				break;
			}

			case 'stop_debug': {
				vscode.debug.setSuppressDebugToolbar(this.debugSession(), true);
				break;
			}

			// If the DAP has commands to execute, such as "n", "f", or "Q",
			// it sends events to let us do it from here.
			case 'execute': {
				const command = msg.params?.command;
				if (command) {
					this.session.execute(
						command,
						this.msgStem + '-dap-' + this.messageCounter++,
						positron.RuntimeCodeExecutionMode.Interactive,
						positron.RuntimeErrorBehavior.Stop
					);
				}
				break;
			}

			// We use the restart button as a shortcut for restarting the runtime
			case 'restart': {
				await this.session.restart();
				break;
			}

			default: {
				return false;
			}
		}

		return true;
	}

	private async startDebugSession(): Promise<vscode.DebugSession | undefined> {
		const promise = new Promise<vscode.DebugSession | undefined>(resolve => {
			const disposable = vscode.debug.onDidStartDebugSession(session => {
				if (session.type === this.config!.type && session.name === this.config!.name) {
					disposable.dispose();
					resolve(session);
				}
			});
		});

		try {
			if (!await vscode.debug.startDebugging(undefined, this.config!, this.debugOptions!)) {
				throw new Error('Failed to start debug session');
			}
		} catch (err) {
			this.session.emitJupyterLog(
				`Can't start debug session for DAP server ${this.comm!.id}: ${err}`,
				vscode.LogLevel.Warning
			);
			return undefined;
		}

		return promise;
	}

	register<T extends vscode.Disposable>(disposable: T): T {
		this.disposables.push(disposable);
		return disposable;
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
		this._comm?.dispose();
	}
}
