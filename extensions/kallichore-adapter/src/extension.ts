/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import path = require('path');
import { KallichoreAdapterApi } from './kallichore-adapter';
import { KCApi } from './KallichoreAdapterApi';

/** Singleton instance of the Kallichore API wrapper */
let apiInstance: KallichoreAdapterApi;

export function activate(context: vscode.ExtensionContext): KallichoreAdapterApi {
	const log = vscode.window.createOutputChannel('Kallichore Adapter', { log: true });
	log.debug('Kallichore Adapter activated');

	// Create the singleton instance of the Kallichore API wrapper
	apiInstance = new KCApi(context, log);

	return apiInstance;
}

export function deactivate() {
	// Dispose of the Kallichore API wrapper if it exists; this closes any open
	// connections
	if (apiInstance) {
		apiInstance.dispose();
	}
}
