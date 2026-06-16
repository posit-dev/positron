/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { createPostgreSQLDriver } from './postgresqlDriver.js';
import { PostgresDataExplorerRpcHandler } from './postgresqlDataExplorerRpcHandler.js';

/**
 * Activates the extension by registering the PostgreSQL data connection driver.
 * @param context The extension context.
 */
export function activate(context: vscode.ExtensionContext) {
	// Services Data Explorer RPCs for tables/views previewed from a PostgreSQL connection.
	const dataExplorerHandler = new PostgresDataExplorerRpcHandler();
	context.subscriptions.push(dataExplorerHandler);

	// Create and register the driver and its cleanup.
	const driver = createPostgreSQLDriver(context, dataExplorerHandler);
	context.subscriptions.push(positron.dataConnections.registerDriver(driver));
}

/** Deactivation is handled by disposing context subscriptions. */
export function deactivate() {
	// Nothing to do.
}
