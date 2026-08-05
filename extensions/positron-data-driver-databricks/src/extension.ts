/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { createDatabricksDriver } from './databricksDriver.js';
import { DatabricksDataExplorerRpcHandler } from './databricksDataExplorerRpcHandler.js';

/**
 * Activates the extension by registering the Databricks data connection driver.
 * @param context The extension context.
 */
export function activate(context: vscode.ExtensionContext) {
	// Diagnostic log channel, surfaced in the Output panel as "Databricks Data Explorer". Used to
	// trace the column-profile query timeline while tuning summary performance.
	const logger = vscode.window.createOutputChannel('Databricks Data Explorer', { log: true });
	context.subscriptions.push(logger);

	// Services Data Explorer RPCs for tables/views previewed from a Databricks connection.
	const dataExplorerHandler = new DatabricksDataExplorerRpcHandler(logger);
	context.subscriptions.push(dataExplorerHandler);

	// Create and register the driver and its cleanup.
	const driver = createDatabricksDriver(context, dataExplorerHandler);
	context.subscriptions.push(positron.dataConnections.registerDriver(driver));
}

/** Deactivation is handled by disposing context subscriptions. */
export function deactivate() {
	// Nothing to do.
}
