/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { createNodeConfigHost } from './odbcConfigHost';
import { OdbcDataExplorerRpcHandler } from './odbcDataExplorerRpcHandler';
import { createOdbcDrivers } from './odbcDriver';
import { discoverOdbcConfiguration, IOdbcConfigHost, resolveUnixConfigPaths } from './odbcinst';

/**
 * Activates the extension by discovering the machine's ODBC configuration and registering a driver
 * for it -- the generic ODBC driver, plus one per recognized database whose ODBC driver is
 * installed.
 */
export function activate(context: vscode.ExtensionContext) {
	// Log to a per-driver output channel, created by core on first use. Nothing may log during
	// activation: the Data Connections pane activates every driver at once, so an activation-time
	// log would add this channel for users who never opened a connection.
	const logger = positron.dataConnections.createDriverLogger('ODBC');
	context.subscriptions.push(logger);

	// Services Data Explorer RPCs for tables/views previewed from an ODBC connection.
	const dataExplorerHandler = new OdbcDataExplorerRpcHandler(logger);
	context.subscriptions.push(dataExplorerHandler);

	const host = createNodeConfigHost();

	// The registered drivers, replaced wholesale whenever the configuration changes. Held in a
	// disposable store of its own rather than on context.subscriptions, which only unwinds at
	// shutdown and would accumulate a stale registration on every reload.
	let registrations: vscode.Disposable[] = [];

	/**
	 * Rebuilds the registered drivers from the machine's current ODBC configuration.
	 *
	 * @param log Whether to report what was found. False on the initial registration: the Data
	 * Connections pane activates every driver at once, so logging there would create this
	 * extension's output channel for every user who opens the pane, including those who never use
	 * ODBC. The logger is lazy precisely so that channel appears only once ODBC is actually used --
	 * on a configuration change, or on a connection.
	 */
	const register = (log: boolean) => {
		for (const registration of registrations) {
			registration.dispose();
		}

		const config = discoverOdbcConfiguration(host);
		if (log) {
			logger.info(`Discovered ${config.drivers.length} ODBC driver(s) and ${config.dsns.length} data source(s) from: ${config.sources.join(', ') || '(no configuration found)'}`);
		}

		registrations = createOdbcDrivers(context, config, dataExplorerHandler, logger)
			.map(driver => positron.dataConnections.registerDriver(driver));
	};

	register(false);

	// ODBC configuration is edited outside Positron -- by an installer, an admin, or the user with
	// a text editor -- so the drivers are rebuilt when those files change rather than only at
	// startup. Driver metadata is otherwise fixed at registration time, so re-registering is how it
	// is refreshed.
	context.subscriptions.push(watchConfiguration(host, () => register(true), logger));

	context.subscriptions.push(new vscode.Disposable(() => {
		for (const registration of registrations) {
			registration.dispose();
		}
		registrations = [];
	}));
}

/**
 * Watches the ODBC configuration files for changes.
 *
 * The files sit outside any workspace folder, so this uses absolute-path watchers rather than a
 * workspace-relative glob. Windows keeps its configuration in the registry, which has no file to
 * watch and no change notification available here; a Windows user who installs a driver while
 * Positron is running picks it up on the next window reload.
 */
function watchConfiguration(
	host: IOdbcConfigHost,
	onChange: () => void,
	logger: positron.DataConnectionLogger
): vscode.Disposable {
	if (host.platform === 'win32') {
		return new vscode.Disposable(() => { });
	}

	const paths = resolveUnixConfigPaths(host);
	const watched = [
		...paths.systemDrivers,
		...paths.systemDsns,
		...paths.userDrivers,
		...paths.userDsns,
	];

	const watchers = watched.map(filePath => {
		// A watcher is created per file rather than per directory: /etc and the home directory are
		// both busy, and a correlated watcher on the exact path is far cheaper than filtering a
		// directory's worth of events.
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(vscode.Uri.file(path.dirname(filePath)), path.basename(filePath)));
		const reload = () => {
			logger.info(`ODBC configuration changed (${filePath}); reloading drivers.`);
			onChange();
		};
		watcher.onDidCreate(reload);
		watcher.onDidChange(reload);
		watcher.onDidDelete(reload);
		return watcher;
	});

	return new vscode.Disposable(() => {
		for (const watcher of watchers) {
			watcher.dispose();
		}
	});
}

/** Deactivation is handled by disposing context subscriptions. */
export function deactivate() {
	// Nothing to do.
}
