/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { DuckDBDataExplorerRpcHandler } from 'positron-data-explorer-duckdb';
import { PinsCache } from './pinsCache.js';
import { createPinsDriver } from './pinsDriver.js';
import { PINS_DATA_EXPLORER_PROVIDER_ID } from './pinsConnection.js';

/**
 * Activates the extension by registering the Posit Connect pins data connection driver.
 * @param context The extension context.
 */
export function activate(context: vscode.ExtensionContext) {
	// Log to a per-driver output channel, created by core on first use. Nothing may log during
	// activation: the Data Connections pane activates every driver at once, so an activation-time
	// log would add this channel for users who never opened a connection. Set the channel's level
	// to Trace (via its gear menu) to see individual requests.
	const logger = positron.dataConnections.createDriverLogger('Posit Connect Pins');
	context.subscriptions.push(logger);

	// Services Data Explorer RPCs for tabular pins previewed from a connection. Uses the shared DuckDB
	// backend under this extension's own provider id.
	const dataExplorerHandler = new DuckDBDataExplorerRpcHandler(PINS_DATA_EXPLORER_PROVIDER_ID);
	context.subscriptions.push(dataExplorerHandler);

	// Downloaded pin data files are cached under the extension's global storage. Prune stale entries
	// once per session (best-effort; never blocks activation).
	const cache = new PinsCache(context.globalStorageUri.fsPath);
	void cache.prune();

	const driver = createPinsDriver(context, dataExplorerHandler, cache, logger);
	context.subscriptions.push(positron.dataConnections.registerDriver(driver));
}

/** Deactivation is handled by disposing context subscriptions. */
export function deactivate() {
	// Nothing to do.
}
