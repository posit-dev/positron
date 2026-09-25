/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { connectionsFilePath, isSameConnectionsFile, readConnectionsFile, SnowflakeConnectionsFileEntry } from './snowflakeConnectionsFile.js';
import { createSnowflakeDriver } from './snowflakeDriver.js';
import { SnowflakeDataExplorerRpcHandler } from './snowflakeDataExplorerRpcHandler.js';

/**
 * How long connections.toml has to be quiet before it is re-read. An editor or the Snowflake CLI
 * may save by deleting and re-creating the file, or with several writes; waiting for the burst to
 * settle reads the file once, as it ends up, rather than mid-save.
 */
const CONNECTIONS_FILE_DEBOUNCE_MS = 250;

/**
 * Activates the extension by reading the connections the user has already configured in
 * connections.toml and registering the Snowflake data connection driver for them.
 * @param context The extension context.
 */
export function activate(context: vscode.ExtensionContext) {
	// Log to a per-driver output channel, created by core on first use. Nothing may log during
	// activation: the Data Connections pane activates every driver at once, so an activation-time
	// log would add this channel for users who never opened a connection.
	const logger = positron.dataConnections.createDriverLogger('Snowflake');
	context.subscriptions.push(logger);

	// Services Data Explorer RPCs for tables/views previewed from a Snowflake connection.
	const dataExplorerHandler = new SnowflakeDataExplorerRpcHandler(logger);
	context.subscriptions.push(dataExplorerHandler);

	// The connections.toml location ($SNOWFLAKE_HOME, else ~/.snowflake), resolved once so the file
	// that is read, the file that is watched, and the file connected from are always the same one.
	const filePath = connectionsFilePath();

	/**
	 * Reads the connections file, or returns undefined if it exists but cannot be read or parsed.
	 * A broken file is reported whether or not anything else is being logged: connections missing
	 * from the pane with nothing to explain them is worse than the output channel appearing early,
	 * and only a broken file reaches this path.
	 */
	const read = (): Record<string, SnowflakeConnectionsFileEntry> | undefined => {
		try {
			return readConnectionsFile(filePath);
		} catch (err) {
			logger.warn(`Could not read the Snowflake connections file (${filePath}): ${err}`);
			return undefined;
		}
	};

	// What the driver currently offers, to tell a real edit from a file event that changed nothing.
	let current = read() ?? {};

	const driver = createSnowflakeDriver(context, dataExplorerHandler, filePath, current, logger);
	context.subscriptions.push(driver);
	context.subscriptions.push(positron.dataConnections.registerDriver(driver));

	// connections.toml is edited outside Positron -- by the Snowflake CLI, or by the user with a
	// text editor -- so the driver is updated when the file changes rather than only at startup.
	// The driver is updated in place, so the connections the user has open stay open.
	context.subscriptions.push(watchConnectionsFile(filePath, () => {
		const connections = read();
		if (connections === undefined) {
			// Keep offering what the last good reading found until the file parses again.
			return;
		}
		if (isSameConnectionsFile(current, connections)) {
			logger.info('The Snowflake connections file defines the same connections.');
			return;
		}
		current = connections;
		logger.info(`Discovered ${Object.keys(connections).length} named connection(s) in ${filePath}.`);
		driver.setFileConnections(connections);
	}, logger));
}

/**
 * Watches connections.toml for changes, calling back once a burst of file events has settled.
 *
 * The file sits outside any workspace folder, so this uses an absolute-path watcher rather than a
 * workspace-relative glob, correlated to the one file rather than to the (busy) directory holding
 * it.
 */
function watchConnectionsFile(
	filePath: string,
	onChange: () => void,
	logger: positron.DataConnectionLogger
): vscode.Disposable {
	const watcher = vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(vscode.Uri.file(path.dirname(filePath)), path.basename(filePath)));
	let timer: ReturnType<typeof setTimeout> | undefined;
	const reload = () => {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			timer = undefined;
			logger.info(`The Snowflake connections file changed (${filePath}).`);
			onChange();
		}, CONNECTIONS_FILE_DEBOUNCE_MS);
	};
	watcher.onDidCreate(reload);
	watcher.onDidChange(reload);
	watcher.onDidDelete(reload);
	return new vscode.Disposable(() => {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
		watcher.dispose();
	});
}

/** Deactivation is handled by disposing context subscriptions. */
export function deactivate() {
	// Nothing to do.
}
