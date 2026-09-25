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
	// that is read and the file that is watched are always the same one.
	const filePath = connectionsFilePath();

	// The current registration, replaced wholesale whenever connections.toml changes. Held on its
	// own rather than on context.subscriptions, which only unwinds at shutdown and would accumulate
	// a stale registration on every reload.
	let registration: vscode.Disposable | undefined;

	// What the current registration was built from, to tell a real edit from a file event that
	// changed nothing. Re-registering disposes every open Snowflake connection, so it happens only
	// when the named connections actually changed.
	let registered: Record<string, SnowflakeConnectionsFileEntry> | undefined;

	/**
	 * Rebuilds the registered driver from the connections file as it stands now.
	 *
	 * @param log Whether to report what was found. False on the initial registration: the Data
	 * Connections pane activates every driver at once, so logging there would create this
	 * extension's output channel for every user who opens the pane, including those who never use
	 * Snowflake. The logger is lazy precisely so that channel appears only once Snowflake is
	 * actually used -- on a change to the file, or on a connection.
	 */
	const register = (log: boolean) => {
		const connections = readConnectionsFile(filePath);
		if (registered !== undefined && isSameConnectionsFile(registered, connections)) {
			logger.info('The Snowflake connections file defines the same connections; keeping the open connections.');
			return;
		}
		registered = connections;

		registration?.dispose();

		if (log) {
			logger.info(`Discovered ${Object.keys(connections).length} named connection(s) in ${filePath}.`);
		}

		registration = positron.dataConnections.registerDriver(
			createSnowflakeDriver(context, dataExplorerHandler, connections, logger));
	};

	register(false);

	// connections.toml is edited outside Positron -- by the Snowflake CLI, or by the user with a
	// text editor -- so the driver is rebuilt when the file changes rather than only at startup. A
	// driver's connections are fixed at registration time, so re-registering is how they refresh.
	context.subscriptions.push(watchConnectionsFile(filePath, () => register(true), logger));

	context.subscriptions.push(new vscode.Disposable(() => {
		registration?.dispose();
		registration = undefined;
	}));
}

/**
 * Watches connections.toml for changes.
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
	const reload = () => {
		logger.info(`The Snowflake connections file changed (${filePath}).`);
		onChange();
	};
	watcher.onDidCreate(reload);
	watcher.onDidChange(reload);
	watcher.onDidDelete(reload);
	return watcher;
}

/** Deactivation is handled by disposing context subscriptions. */
export function deactivate() {
	// Nothing to do.
}
