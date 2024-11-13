/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { KallichoreAdapterApi } from './positron-supervisor';
import { KCApi } from './KallichoreAdapterApi';

/** Singleton instance of the Kallichore API wrapper */
export let API_INSTANCE: KCApi;

export function activate(context: vscode.ExtensionContext): KallichoreAdapterApi {
	const log = positron.window.createRawLogOutputChannel('Positron Kernel Supervisor');
	log.appendLine('Positron Kernel Supervisor activated');

	// Create the singleton instance of the Kallichore API wrapper
	API_INSTANCE = new KCApi(context, log);

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
