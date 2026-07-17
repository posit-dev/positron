/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { DuckDBDataExplorerRpcHandler } from 'positron-data-explorer-duckdb';
import { createDuckDBDriver } from './duckdbDriver.js';
import { DUCKDB_DATA_EXPLORER_PROVIDER_ID } from './duckdbConnection.js';

/**
 * Activates the extension by registering the DuckDB data connection driver.
 * @param context The extension context.
 */
export function activate(context: vscode.ExtensionContext) {
	// Services Data Explorer RPCs for tables/views previewed from a DuckDB connection.
	const dataExplorerHandler = new DuckDBDataExplorerRpcHandler(DUCKDB_DATA_EXPLORER_PROVIDER_ID);
	context.subscriptions.push(dataExplorerHandler);

	// Create and register the driver and its cleanup.
	const driver = createDuckDBDriver(context, dataExplorerHandler);
	context.subscriptions.push(positron.dataConnections.registerDriver(driver));
}

/** Deactivation is handled by disposing context subscriptions. */
export function deactivate() {
	// Nothing to do.
}
