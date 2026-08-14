/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { createSQLiteDriver } from './sqliteDriver.js';
import { SqliteDataExplorerRpcHandler } from './sqliteDataExplorerRpcHandler.js';

/**
 * Activates the extension by registering the SQLite data connection driver.
 * @param context The extension context.
 */
export function activate(context: vscode.ExtensionContext) {
	// Log to a per-driver output channel, created by core on first use. Nothing may log during
	// activation: the Data Connections pane activates every driver at once, so an activation-time
	// log would add this channel for users who never opened a connection.
	const logger = positron.dataConnections.createDriverLogger('SQLite');
	context.subscriptions.push(logger);

	// Services Data Explorer RPCs for tables/views previewed from a SQLite connection.
	const dataExplorerHandler = new SqliteDataExplorerRpcHandler(logger);
	context.subscriptions.push(dataExplorerHandler);

	// Create and register the driver and its cleanup.
	const driver = createSQLiteDriver(context, dataExplorerHandler, logger);
	context.subscriptions.push(positron.dataConnections.registerDriver(driver));
}

/** Deactivation is handled by disposing context subscriptions. */
export function deactivate() {
	// Nothing to do.
}
