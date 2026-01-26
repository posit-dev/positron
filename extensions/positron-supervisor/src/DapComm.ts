/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { JupyterLanguageRuntimeSession, Comm } from './positron-supervisor';
import { Debounced } from './util';

/**
 * A Debug Adapter Protocol (DAP) comm.
 * See `positron-supervisor.d.ts` for documentation.
 */
export class DapComm {
	public get comm(): Comm {
		return this._comm;
	}
	public get port(): number {
		return this._port;
	}

	private _debugSession?: vscode.DebugSession;
	private _startingSession?: Promise<void>;
	private _stopDebug = new Debounced(100);
	private connected = false;
	private readonly disposables: vscode.Disposable[] = [];

	// Message counter used for creating unique message IDs
	private messageCounter = 0;

	// Random stem for messages
	private readonly msgStem: string;

	private constructor(
		private readonly session: JupyterLanguageRuntimeSession,
		readonly targetName: string,
		readonly debugType: string,
		readonly debugName: string,
		private readonly _comm: Comm,
		private readonly _port: number,
		private readonly config: vscode.DebugConfiguration,
		private readonly debugOptions: vscode.DebugSessionOptions,
	) {
		this.msgStem = Math.random().toString(16).slice(2, 10);

		// Reconnect sessions automatically as long as we are "connected"
		this.register(vscode.debug.onDidTerminateDebugSession(async (terminatedSession) => {
			if (terminatedSession !== this._debugSession) {
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

	static async create(
		session: JupyterLanguageRuntimeSession,
		targetName: string,
		debugType: string,
		debugName: string,
	): Promise<DapComm> {
		// NOTE: Ideally we'd allow connecting to any network interface but the
		// `debugServer` property passed in the configuration below needs to be
		// localhost.
		const host = '127.0.0.1';

		const [comm, serverPort] = await session.createServerComm(targetName, host);

		session.emitJupyterLog(`Starting debug session for DAP server ${comm.id}`);

		const config: vscode.DebugConfiguration = {
			type: debugType,
			name: debugName,
			request: 'attach',
			debugServer: serverPort,
			internalConsoleOptions: 'neverOpen',
		};

		const debugOptions: vscode.DebugSessionOptions = {
			suppressDebugToolbar: true,
			suppressDebugStatusbar: true,
		};

		return new DapComm(
			session,
			targetName,
			debugType,
			debugName,
			comm,
			serverPort,
			config,
			debugOptions,
		);
	}

	async connect() {
		this.connected = true;

		if (this._debugSession) {
			return;
		}
		if (this._startingSession) {
			return this._startingSession;
		}

		this.session.emitJupyterLog(
			`Connecting to DAP server on port ${this._port}`,
			vscode.LogLevel.Info
		);

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

		this.session.emitJupyterLog(
			`Disconnecting from DAP server on port ${this._port}`,
			vscode.LogLevel.Info
		);

		await vscode.debug.stopDebugging(session);
	}

	private debugSession(): vscode.DebugSession {
		if (!this._debugSession) {
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
				// Cancel any pending stop handler. We debounce these to avoid flickering.
				this._stopDebug.cancel();
				vscode.debug.setSuppressDebugToolbar(this.debugSession(), false);
				vscode.debug.setSuppressDebugStatusbar(this.debugSession(), false);
				break;
			}

			case 'stop_debug': {
				// Debounce the stop handler in case we restart right away. This
				// prevents flickering in the debug pane.
				this._stopDebug.schedule(() => {
					if (this._debugSession) {
						vscode.debug.setSuppressDebugToolbar(this._debugSession, true);
						vscode.debug.setSuppressDebugStatusbar(this._debugSession, true);
					}
				});
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
				if (session.type === this.config.type && session.name === this.config.name) {
					disposable.dispose();
					resolve(session);
				}
			});
		});

		try {
			if (!await vscode.debug.startDebugging(undefined, this.config, this.debugOptions)) {
				throw new Error('Failed to start debug session');
			}
		} catch (err) {
			this.session.emitJupyterLog(
				`Can't start debug session for DAP server ${this._comm.id}: ${err}`,
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
		this._stopDebug.flush();
		this.disposables.forEach(d => d.dispose());
		this._comm.dispose();
	}
}
