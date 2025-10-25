/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as os from 'os';

import { PositronSupervisorApi } from './positron-supervisor';
import { KCApi } from './KallichoreAdapterApi';
import { KallichoreTransport } from './KallichoreApiInstance';
import { KallichoreInstances } from './KallichoreInstances';

/** Singleton instance of the Kallichore API wrapper */
export let API_INSTANCE: KCApi;

export function activate(context: vscode.ExtensionContext): PositronSupervisorApi {
	const log = positron.window.createRawLogOutputChannel('Kernel Supervisor');
	log.appendLine('Positron Kernel Supervisor activated');
	KallichoreInstances.initialize(context, log);

	// Determine transport type from configuration
	const config = vscode.workspace.getConfiguration('kernelSupervisor');
	const configTransport = config.get<string>('transport', 'ipc');

	let transport: KallichoreTransport;
	if (configTransport === 'tcp') {
		transport = KallichoreTransport.TCP;
	} else if (configTransport === 'ipc') {
		// Use platform-appropriate IPC transport
		if (os.platform() === 'win32') {
			transport = KallichoreTransport.NamedPipe;
		} else {
			transport = KallichoreTransport.UnixSocket;
		}
	} else {
		// Default to TCP for unknown values
		transport = KallichoreTransport.TCP;
	}

	// Create the singleton instance of the Kallichore API wrapper
	API_INSTANCE = new KCApi(context, log, transport, true);

	// Register the supervisor commands
	API_INSTANCE.registerCommands();

	context.subscriptions.push(vscode.commands.registerCommand('positron.supervisor.showRunningSupervisors', () => {
		return KallichoreInstances.showRunningSupervisors();
	}));

	// Listen for the command to open the logs
	context.subscriptions.push(vscode.commands.registerCommand('positron.supervisor.showKernelSupervisorLog', () => {
		log.show();
	}));

	return API_INSTANCE;
}

export function deactivate() {
	// Dispose of the Kallichore API wrapper if it exists; this closes any open
	// connections
	if (API_INSTANCE) {
		API_INSTANCE.dispose();
	}
}
