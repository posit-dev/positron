/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as os from 'os';

import path = require('path');
import { KallichoreAdapterApi } from './kallichore-adapter';
import { KCApi } from './KallichoreAdapterApi';

export function activate(context: vscode.ExtensionContext): KallichoreAdapterApi {
	const log = vscode.window.createOutputChannel('Kallichore Adapter', { log: true });
	log.debug('Kallichore Adapter activated');
	return new KCApi(context, log);
}

export function deactivate() {
}
