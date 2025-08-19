/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { JupyterLanguageRuntimeSession, RawComm } from './positron-supervisor';

/**
 * A Debug Adapter Protocol (DAP) client instance; handles messages from the
 * kernel side of the DAP and forwards them to the debug adapter.
 */
export class DapComm {
	public get comm(): RawComm | undefined {
		return this._comm;
	}
	public get port(): number | undefined {
		return this._port;
	}

	private _comm?: RawComm;
	private _port?: number;

	/** Message counter; used for creating unique message IDs */
	private messageCounter = 0;

	/** Random stem for messages */
	private msgStem: string;

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
	}

	handleMessage(msg: any): boolean {
		if (msg.kind === 'request') {
			return false;
		}

		switch (msg.method) {
			// The runtime is in control of when to start a debug session.
			// When this happens, we attach automatically to the runtime
			// with a synthetic configuration.
			case 'start_debug': {
				this.session.emitJupyterLog(`Starting debug session for DAP server ${this.comm!.id}`);
				const config: vscode.DebugConfiguration = {
					type: this.debugType,
					name: this.debugName,
					request: 'attach',
					debugServer: this.port,
					internalConsoleOptions: 'neverOpen',
				};

				// Log errors because this sometimes fail at
				// https://github.com/posit-dev/positron/blob/71686862/src/vs/workbench/contrib/debug/browser/debugService.ts#L361
				// because `hasDebugged` is undefined.
				try {
					vscode.debug.startDebugging(undefined, config);
				} catch (err) {
					this.session.emitJupyterLog(
						`Can't start debug session for DAP server ${this.comm!.id}: ${err}`,
						vscode.LogLevel.Warning
					);
				}

				return true;
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

				return true;
			}

			// We use the restart button as a shortcut for restarting the runtime
			case 'restart': {
				this.session.restart();
				return true;
			}

			default: {
				return false;
			}
		}
	}

	/**
	 * Dispose of the underlying comm, if present.
	 */
	dispose(): void {
		this._comm?.dispose();
	}
}
