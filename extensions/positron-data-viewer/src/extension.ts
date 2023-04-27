/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { createDataPanel } from './dataPanel';
import { DataSet } from './positron-data-viewer';

/**
 * Called when the extension is activated.
 *
 * @param context The extension context
 */
export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		positron.runtime.registerClientHandler({
			clientType: 'positron.dataViewer',
			callback: (client, params: object) => {
				// Presume that the params are a DataSet
				const dataSet = params as DataSet;

				// Create a data panel for the data set
				createDataPanel(context, client, dataSet);

				// Return true to indicate that we are taking ownership of the client
				// of the client
				return true;
			}
		}));
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate() {
}
