/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as positron from 'positron';
import { OdbcDialect } from './odbcDatabases';
import { isLibraryPath, looksLikeLibraryFilename } from './odbcinst';
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
 *
 * The driver manager's diagnostics about loading a driver or finding a data source are rewritten
 * too, for the same reason: they describe the machine's ODBC configuration rather than the
 * database, and the raw text names a shared object and a dlopen failure, which reads as a Positron
 * fault. Diagnostics from the database driver itself are still passed through untouched.
 *
 * @param error The failure the worker reported.
 * @param platform The platform whose driver manager produced it. Only tests pass this.
 * @param exists Whether a path exists. Only tests pass this.
 */
export function describeConnectError(
	error: unknown,
	platform: NodeJS.Platform = process.platform,
	exists: (filePath: string) => boolean = fs.existsSync
): string {
	const odbcError = error as OdbcError;

	if (odbcError?.driverManagerMissing) {
		switch (platform) {
			case 'darwin':
				return 'The unixODBC driver manager is not installed. Install it with "brew install unixodbc" and try again.';
			case 'win32':
				// Windows ships a driver manager, so reaching this means something stranger.
				return `The ODBC driver manager could not be loaded: ${odbcError.message}`;
			default:
				return 'The unixODBC driver manager is not installed. Install your distribution\'s unixODBC package (e.g. "apt install unixodbc" or "dnf install unixODBC") and try again.';
		}
	}

	const message = odbcError?.message ?? String(error);

	// unixODBC loads a driver through libltdl, which reports "file not found" for every load
	// failure, including a library that is on disk but will not load. So the reason it gives says
	// nothing, and what the quoted value is decides the message instead.
	const cannotOpen = /Can't open lib '(?<library>[^']*)'\s*(?::\s*(?<reason>.*))?/i.exec(message);
	const library = cannotOpen?.groups?.library;
	if (library) {
		// A driver name nothing is registered under. unixODBC falls back to loading the name itself
		// as a library, so a mistyped `Driver=` in a connection string arrives here.
		if (!isLibraryPath(library) && !looksLikeLibraryFilename(library)) {
			return `No ODBC driver named '${library}' is registered on this computer. Check the driver name, or register the driver in your odbcinst.ini.`;
		}

		// The library is not on disk. Usually a versioned path left behind by an upgrade: Homebrew's
		// psqlodbc writes its Cellar path into the ini files, and every `brew upgrade` deletes the
		// directory that path points at.
		if (isLibraryPath(library) && !exists(library)) {
			return `This data source uses an ODBC driver that is not installed at ${library}. Reinstall the driver, or correct the path in your odbcinst.ini or odbc.ini.`;
		}

		// On disk, or a bare filename left to the dynamic linker, and it did not load: built for
		// another architecture, or missing a library of its own. A driver manager that says which
		// has its reason kept; libltdl's "file not found" is left out, since it is not true.
		const reason = cannotOpen?.groups?.reason?.trim();
		const detail = reason && !/^file not found$/i.test(reason) ? ` (${reason})` : '';
		return `The ODBC driver at ${library} could not be loaded${detail}. The driver may be built for a different architecture than this computer, or a library it depends on may be missing.`;
	}

	// Windows reports this too, but keeps its data sources in the registry rather than odbc.ini.
	if (/Data source name not found/i.test(message)) {
		return platform === 'win32'
			? 'No ODBC data source or driver by that name is configured on this computer. Check the name, or add the data source in ODBC Data Source Administrator (64-bit).'
			: 'No ODBC data source or driver by that name is configured on this computer. Check the name, or define the data source in your odbc.ini.';
	}

	return message;
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
