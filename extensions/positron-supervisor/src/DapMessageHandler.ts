/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { JupyterLanguageRuntimeSession } from './positron-supervisor';

/**
 * Handles DAP (Debug Adapter Protocol) messages from the kernel side.
 *
 * @param msg The message from the kernel
 * @param session The Jupyter runtime session
 * @param clientId The DAP client identifier
 * @param serverPort The port the DAP server is running on
 * @param debugType The debug configuration type
 * @param debugName The debug configuration name
 * @returns true if the message was handled, false otherwise
 */
/** Message counter; used for creating unique message IDs */
let messageCounter = 0;

export function handleDapMessage(
	msg: any,
	session: JupyterLanguageRuntimeSession,
	clientId: string,
	serverPort: number,
	debugType: string,
	debugName: string
): boolean {

	// Generate 8 random hex characters for the message stem
	const msgStem = Math.random().toString(16).slice(2, 10);

	switch (msg.msg_type) {
		// The runtime is in control of when to start a debug session.
		// When this happens, we attach automatically to the runtime
		// with a synthetic configuration.
		case 'start_debug': {
			session.emitJupyterLog(`Starting debug session for DAP server ${clientId}`);
			const config: vscode.DebugConfiguration = {
				type: debugType,
				name: debugName,
				request: 'attach',
				debugServer: serverPort,
				internalConsoleOptions: 'neverOpen',
			};
			vscode.debug.startDebugging(undefined, config);
			return true;
		}

		// If the DAP has commands to execute, such as "n", "f", or "Q",
		// it sends events to let us do it from here.
		case 'execute': {
			session.execute(
				msg.content.command,
				msgStem + '-dap-' + messageCounter++,
				positron.RuntimeCodeExecutionMode.Interactive,
				positron.RuntimeErrorBehavior.Stop
			);
			return true;
		}

		// We use the restart button as a shortcut for restarting the runtime
		case 'restart': {
			session.restart();
			return true;
		}

		default: {
			session.emitJupyterLog(`Unknown DAP command: ${msg.msg_type}`);
			return false;
		}
	}
}
