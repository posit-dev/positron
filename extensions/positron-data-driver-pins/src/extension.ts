/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { DuckDBDataExplorerRpcHandler } from 'positron-data-explorer-duckdb';
import { Logger } from './logging.js';
import { PinsCache } from './pinsCache.js';
import { createPinsDriver } from './pinsDriver.js';
import { PINS_DATA_EXPLORER_PROVIDER_ID } from './pinsConnection.js';

/**
 * Builds a {@link Logger} backed by an output channel that is created on first use. Deferring
 * creation keeps the "Posit Connect Pins" channel out of the Output panel until the driver
 * actually logs something (i.e. the first connection attempt), so activating the extension by
 * opening the Data Connections pane doesn't add an empty channel.
 *
 * @param name The output channel name.
 * @param context The extension context; the channel is registered for disposal once created.
 */
function createLazyChannelLogger(name: string, context: vscode.ExtensionContext): Logger {
	let channel: vscode.LogOutputChannel | undefined;
	const channelFor = () => {
		if (!channel) {
			channel = vscode.window.createOutputChannel(name, { log: true });
			context.subscriptions.push(channel);
		}
		return channel;
	};
	return {
		trace: message => channelFor().trace(message),
		debug: message => channelFor().debug(message),
		info: message => channelFor().info(message),
		warn: message => channelFor().warn(message),
		error: message => channelFor().error(message),
	};
}

/**
 * Activates the extension by registering the Posit Connect pins data connection driver.
 * @param context The extension context.
 */
export function activate(context: vscode.ExtensionContext) {
	// Log to a per-driver output channel, created on first use. The "Data Connections: " prefix is a
	// shared convention across the data connection drivers so their channels cluster together in the
	// Output dropdown (e.g. "Data Connections: PostgreSQL"). Set the channel's level to Trace (via
	// its gear menu) to see individual requests.
	const logger = createLazyChannelLogger('Data Connections: Posit Connect Pins', context);

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
