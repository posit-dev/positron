/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { PositronSupervisorApi } from './positron-supervisor';
import { KCApi } from './KallichoreAdapterApi';
import { DapComm } from './DapComm';

/** Singleton instance of the Kallichore API wrapper */
export let API_INSTANCE: KCApi;

export function activate(context: vscode.ExtensionContext): PositronSupervisorApi {
	const log = positron.window.createRawLogOutputChannel('Kernel Supervisor');
	log.appendLine('Positron Kernel Supervisor activated');

	// Create the singleton instance of the Kallichore API wrapper
	API_INSTANCE = new KCApi(context, log);

	// Listen for the command to open the logs
	context.subscriptions.push(vscode.commands.registerCommand('positron.supervisor.showKernelSupervisorLog', () => {
		log.show();
	}));

	// Create extended API that includes implementations
	const extendedApi = Object.create(API_INSTANCE);
	extendedApi.implementations = {
		DapComm
	};

	return extendedApi;
}

export function deactivate() {
	// Dispose of the Kallichore API wrapper if it exists; this closes any open
	// connections
	if (API_INSTANCE) {
		API_INSTANCE.dispose();
	}
}
