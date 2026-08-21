/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { OdbcDialect } from './odbcDatabases';
import { redactConnectionString } from './odbcConnectionString';
import { IOdbcDataExplorerHost, ODBC_DATA_EXPLORER_PROVIDER_ID } from './odbcDataExplorerRpcHandler';
import { createRootNodes, fetchTables, IOdbcPreviewHost, OdbcTableRef } from './odbcNodes';
import { OdbcError, OdbcWorkerClient } from './odbcWorkerClient';

/** Monotonically increasing id so each connection's previewed datasets get a unique key. */
let nextConnectionId = 1;

/**
 * Turns a worker failure into something a user can act on.
 *
 * The case worth special-casing is the driver manager being absent: on macOS and Linux the binding
 * links against unixODBC, and without it every connection fails at dlopen with a message about a
 * missing shared library, which reads as a Positron bug rather than a missing prerequisite.
 * Everything else is passed through -- ODBC drivers report their own diagnostics, and those are
 * more specific than anything this layer could substitute.
 */
export function describeConnectError(error: unknown): string {
	const odbcError = error as OdbcError;

	if (odbcError?.driverManagerMissing) {
		switch (process.platform) {
			case 'darwin':
				return 'The unixODBC driver manager is not installed. Install it with "brew install unixodbc" and try again.';
			case 'win32':
				// Windows ships a driver manager, so reaching this means something stranger.
				return `The ODBC driver manager could not be loaded: ${odbcError.message}`;
			default:
				return 'The unixODBC driver manager is not installed. Install your distribution\'s unixODBC package (e.g. "apt install unixodbc" or "dnf install unixODBC") and try again.';
		}
	}

	return odbcError?.message ?? String(error);
}

/**
 * A live ODBC connection implementing the DataConnection interface.
 *
 * The native ODBC connection runs in a separate child process via OdbcWorkerClient, so a fault in a
 * third-party vendor driver takes down only that child rather than the extension host. This class
 * is a thin host-side facade over the worker client; schema browsing is provided via getChildren().
 */
export class OdbcConnection implements positron.DataConnection, IOdbcPreviewHost {
	/** The worker client, or undefined before connect() / after disconnect(). */
	private _client: OdbcWorkerClient | undefined;

	/** Unique id for this connection, used to key its previewed datasets. */
	private readonly _connectionId = `odbc-${nextConnectionId++}`;

	/** Dataset ids opened via preview, so they can be released on disconnect. */
	private readonly _openedDatasets = new Set<string>();

	/**
	 * The table list, fetched once on first expansion. SQLTables is a single round trip that returns
	 * every table on the connection (see odbcNodes.ts), so it is fetched once and the tree is built
	 * from it for the life of the connection.
	 */
	private _tables: OdbcTableRef[] | undefined;

	/**
	 * @param _connectionString The full ODBC connection string.
	 * @param _dialect How to write SQL for this backend, resolved from the ODBC driver name.
	 * @param _dataExplorerHandler Hosts table views previewed in the Data Explorer.
	 * @param _logger Optional diagnostic log sink for connection lifecycle events.
	 */
	constructor(
		private readonly _connectionString: string,
		private readonly _dialect: OdbcDialect,
		private readonly _dataExplorerHandler: IOdbcDataExplorerHost,
		private readonly _logger?: positron.DataConnectionLogger
	) { }

	/**
	 * Opens the connection in the worker process. Must be called before any other method. Rejects
	 * with a descriptive error if the connection cannot be established.
	 */
	async connect(): Promise<void> {
		// The connection string is logged redacted: it routinely embeds a password, and the driver
		// log is a file the user may well share when reporting a problem.
		this._logger?.info(`Connecting: ${redactConnectionString(this._connectionString)}`);

		const client = new OdbcWorkerClient(this._connectionString);
		try {
			// Establish the connection here so a failure surfaces from connect() rather than from
			// the first expansion of the tree.
			await client.connect();
			this._client = client;
		} catch (error) {
			client.dispose();
			const message = describeConnectError(error);
			this._logger?.error(`Failed to connect: ${message}`);
			throw new Error(message);
		}

		// A worker that dies later leaves the tree pointing at a connection that no longer exists.
		// Log it; the next request respawns the worker and reconnects.
		client.onDidCrash(() => this._logger?.warn('The ODBC process terminated unexpectedly; it will be restarted on the next request.'));

		this._logger?.info('Connected');
	}

	/**
	 * Returns the top-level nodes. The shape depends on what the backend uses -- catalogs, schemas,
	 * or neither -- so it is derived from the table list rather than fixed.
	 */
	async getChildren(): Promise<positron.DataConnectionNode[]> {
		this._ensureConnected();
		this._tables ??= await fetchTables(this._client!);
		return createRootNodes(this._tables, this._client!, this);
	}

	/**
	 * Opens the given table or view in the Data Explorer. Registers a table view with the RPC
	 * handler under a stable per-connection dataset id, then asks Positron to open (or focus) the
	 * explorer backed by this extension's RPC command. Returns the dataset id it was opened under,
	 * which Positron uses to tell that this connection has a Data Explorer open on it.
	 */
	async previewObject(ref: OdbcTableRef): Promise<string> {
		this._ensureConnected();
		const datasetId = `odbc:${this._connectionId}:${qualifiedKey(ref)}`;
		await this._dataExplorerHandler.openTableView(datasetId, this._client!, ref, this._dialect);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: ODBC_DATA_EXPLORER_PROVIDER_ID,
			datasetId,
			displayName: ref.name,
		});
		return datasetId;
	}

	/**
	 * Opens a single column of the given table or view in the Data Explorer as a one-column grid.
	 * Uses a dataset id distinct from the table's so both can be open at once. Returns the dataset
	 * id it was opened under.
	 */
	async previewColumn(ref: OdbcTableRef, columnName: string): Promise<string> {
		this._ensureConnected();
		const datasetId = `odbc:${this._connectionId}:column:${qualifiedKey(ref)}.${columnName}`;
		await this._dataExplorerHandler.openColumnView(datasetId, this._client!, ref, this._dialect, columnName);
		this._openedDatasets.add(datasetId);
		await positron.dataExplorer.open({
			providerId: ODBC_DATA_EXPLORER_PROVIDER_ID,
			datasetId,
			displayName: `${ref.name}.${columnName}`,
		});
		return datasetId;
	}

	/**
	 * ODBC exposes the connection's read-only state through SQLGetInfo, which node-odbc does not
	 * surface, so there is nothing to report it from. Connections are treated as writable; Positron
	 * uses this only to decide whether to offer write affordances, and this driver offers none.
	 */
	async isReadOnly(): Promise<boolean> {
		return false;
	}

	/** Closes the connection and releases any previewed table views. Idempotent. */
	async disconnect(): Promise<void> {
		for (const datasetId of this._openedDatasets) {
			this._dataExplorerHandler.closeTableView(datasetId);
		}
		this._openedDatasets.clear();
		this._client?.dispose();
		this._client = undefined;
		this._tables = undefined;
	}

	/** Checks whether the connection is still open and operational. */
	async isConnected(): Promise<boolean> {
		// A crashed worker leaves the client present but not alive; don't respawn just to answer
		// this question.
		if (!this._client || !this._client.isAlive) {
			return false;
		}
		try {
			await this._client.tables(null, null, '', '');
			return true;
		} catch {
			return false;
		}
	}

	/** Throws if the connection has been closed. */
	private _ensureConnected(): void {
		if (!this._client) {
			throw new Error('The ODBC connection is closed');
		}
	}
}

/** A stable, collision-free key for a table within a connection, used to build dataset ids. */
function qualifiedKey(ref: OdbcTableRef): string {
	return [ref.catalog, ref.schema, ref.name].filter(part => part !== undefined).join('.');
}
