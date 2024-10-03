/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { JupyterLanguageRuntimeSession } from './jupyter-adapter';

/**
 * A Debug Adapter Protocol (DAP) client instance; handles messages from the
 * kernel side of the DAP and forwards them to the debug adapter.
 */
export class DapClient {
	/** Message counter; used for creating unique message IDs */
	private static _counter = 0;

	private _msgStem: string;

	constructor(readonly clientId: string,
		readonly serverPort: number,
		readonly debugType: string,
		readonly debugName: string,
		readonly session: JupyterLanguageRuntimeSession) {

		// Generate 8 random hex characters for the message stem
		this._msgStem = Math.random().toString(16).substr(2, 8);
	}

	handleDapMessage(msg: any) {
		switch (msg.msg_type) {
			// The runtime is in control of when to start a debug session.
			// When this happens, we attach automatically to the runtime
			// with a synthetic configuration.
			case 'start_debug': {
				this.session.emitJupyterLog(`Starting debug session for DAP server ${this.clientId}`);
				const config = {
					type: this.debugType,
					name: this.debugName,
					request: 'attach',
					debugServer: this.serverPort,
					internalConsoleOptions: 'neverOpen',
				} as vscode.DebugConfiguration;
				vscode.debug.startDebugging(undefined, config);
				break;
			}

			// If the DAP has commands to execute, such as "n", "f", or "Q",
			// it sends events to let us do it from here.
			case 'execute': {
				this.session.execute(
					msg.content.command,
					this._msgStem + '-dap-' + DapClient._counter++,
					positron.RuntimeCodeExecutionMode.Interactive,
					positron.RuntimeErrorBehavior.Stop
				);
				break;
			}

			// We use the restart button as a shortcut for restarting the runtime
			case 'restart': {
				this.session.restart();
				break;
			}

			default: {
				this.session.emitJupyterLog(`Unknown DAP command: ${msg.msg_type}`);
				break;
			}
		}
	}
}
