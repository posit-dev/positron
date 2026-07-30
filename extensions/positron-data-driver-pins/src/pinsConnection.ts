/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { DuckDBWorkerClient, IDuckDBDataExplorerHost } from 'positron-data-explorer-duckdb';
import { BundleInfo, ConnectClient, PinInfo } from './connectClient.js';
import { Logger, NULL_LOGGER } from './logging.js';
import { PinsCache } from './pinsCache.js';
import { createPinReadCodeGenerator } from './pinsCode.js';
import { duckdbReaderForPinType } from './pinTypes.js';
import { createOwnerNode, IPinsBrowseHost } from './pinsNodes.js';

/** The Data Explorer provider id this connection opens previewed pins under. */
export const PINS_DATA_EXPLORER_PROVIDER_ID = 'positron-data-driver-pins';

/**
 * Data files at or above this size get a progress notification while downloading; smaller ones rely
 * on the tree row's spinner alone, to avoid a toast for downloads that finish in a moment. A
 * heuristic, not a hard rule: the pin's recorded `file_size` drives the choice, and an unrecorded
 * size falls through to the quiet path.
 */
const DOWNLOAD_PROGRESS_MIN_BYTES = 10 * 1024 * 1024;

/** Monotonically increasing id so each connection's previewed datasets get a unique key. */
let nextConnectionId = 1;

/** Escapes a value for a single-quoted SQL string literal (DuckDB doubles the quote to escape it). */
function quoteSqlLiteral(value: string): string {
	return value.replace(/'/g, '\'\'');
}

/** A DuckDB-safe, deterministic table name for a previewed pin version (so re-previews reuse it). */
function previewTableName(guid: string, bundleId: string): string {
	return `pin_${guid}_${bundleId}`.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * A live connection to a Posit Connect server's pins, implementing the DataConnection interface.
 *
 * There is no persistent socket: each browse action is a stateless HTTPS request carrying the API
 * key. Each top-level browse re-enumerates the pins (the connection is torn down and rebuilt when
 * its tree entry is collapsed and re-expanded, so there is nothing to cache across); a successful
 * per-pin type lookup is memoized because an owner node can be collapsed and re-expanded without
 * disconnecting, while a failed one is retried on the next re-expand.
 *
 * Previewing a tabular pin downloads its data file (cached on disk) and queries it with a DuckDB
 * instance that runs in a child process (via DuckDBWorkerClient) so a native failure takes down only
 * that child, not the extension host. The database is in-memory: each previewed version becomes a
 * table in it, so no worker pool is needed (there is no database file to lock).
 */
export class PinsConnection implements positron.DataConnection, IPinsBrowseHost {
	/** Set once disconnected, so browsing after disconnect fails cleanly. */
	private _disconnected = false;

	/**
	 * Per-version type lookups, keyed by `guid:bundleId`, so a version's `data.txt` is fetched at most
	 * once on success. Keyed per version (not per pin) because a pin's storage type can differ across
	 * versions, which determines each version's preview availability.
	 */
	private readonly _typeCache = new Map<string, Promise<string | undefined>>();

	/** The in-memory DuckDB worker backing previews, created lazily on the first preview. */
	private _worker: DuckDBWorkerClient | undefined;

	/** Unique id for this connection, used to key its previewed datasets. */
	private readonly _connectionId = `pins-${nextConnectionId++}`;

	/** Dataset ids opened via preview, so their table views can be released on disconnect. */
	private readonly _openedDatasets = new Set<string>();

	/**
	 * @param _client The Connect client, already validated by the driver's connect().
	 * @param _dataExplorerHandler Hosts the table views previewed pins are shown in.
	 * @param _cache The on-disk cache downloaded pin data files are stored in.
	 * @param _logger Logs browse activity; defaults to a no-op logger.
	 */
	constructor(
		private readonly _client: ConnectClient,
		private readonly _dataExplorerHandler: IDuckDBDataExplorerHost,
		private readonly _cache: PinsCache,
		private readonly _logger: Logger = NULL_LOGGER
	) { }

	/** Pins are browsed read-only; writing pins is out of scope for this driver. */
	async isReadOnly(): Promise<boolean> {
		return true;
	}

	/**
	 * Returns the top-level nodes: one per owner that has at least one visible pin, sorted
	 * alphabetically. Each owner node expands to that owner's pins.
	 */
	async getChildren(): Promise<positron.DataConnectionNode[]> {
		this._ensureConnected();
		const pins = await this._client.listPins();

		const pinsByOwner = new Map<string, PinInfo[]>();
		for (const pin of pins) {
			const owner = pinsByOwner.get(pin.ownerUsername);
			if (owner) {
				owner.push(pin);
			} else {
				pinsByOwner.set(pin.ownerUsername, [pin]);
			}
		}

		this._logger.info(`Browsing ${pins.length} pin(s) across ${pinsByOwner.size} owner(s)`);
		return [...pinsByOwner.keys()]
			.sort((a, b) => a.localeCompare(b))
			.map(owner => createOwnerNode(this, owner, pinsByOwner.get(owner)!));
	}

	/**
	 * Resolves a pin's storage type for the badge. A successful lookup is memoized; a failed one is
	 * dropped from the cache (matching the enumeration's retry-rather-than-cache-rejections behavior)
	 * so a later re-expand retries it, and shows no badge in the meantime rather than failing the
	 * whole owner expansion.
	 */
	async getPinType(pin: PinInfo): Promise<string | undefined> {
		// The badge reflects the active (currently served) version's type.
		return this.getVersionType(pin, pin.activeBundleId);
	}

	/**
	 * Resolves a specific version's storage type, used to gate that version's preview (and, for the
	 * active version, the pin's type badge). A successful lookup is memoized per (guid, bundle); a
	 * failed one is dropped so a later re-expand retries, offering no preview in the meantime rather
	 * than failing the whole expansion.
	 */
	async getVersionType(pin: PinInfo, bundleId: string): Promise<string | undefined> {
		const key = `${pin.guid}:${bundleId}`;
		let typePromise = this._typeCache.get(key);
		if (!typePromise) {
			typePromise = this._client.getPinMeta(pin.guid, bundleId).then(meta => meta.type || undefined);
			this._typeCache.set(key, typePromise);
		}
		try {
			return await typePromise;
		} catch {
			// The lookup failed: drop it so a later re-expand retries, and show no badge/preview this time.
			this._typeCache.delete(key);
			return undefined;
		}
	}

	/**
	 * Lists a pin's versions (bundles), newest first, when a pin node is expanded. Fetched fresh each
	 * time (not cached): it is a single request, and a live fetch surfaces newly published versions.
	 */
	async getBundles(pin: PinInfo): Promise<BundleInfo[]> {
		this._ensureConnected();
		return this._client.listBundles(pin.guid);
	}

	/**
	 * Opens a pin version's tabular data in the Data Explorer. Reads the version's metadata to find
	 * its data file, downloads that file (reusing the cached copy when present), loads it into the
	 * DuckDB worker as a table, and opens the explorer over it. Convert-to-Code in the resulting
	 * explorer emits `pin_read` code rather than SQL against the throwaway table.
	 */
	async previewPin(pin: PinInfo, bundleId: string, isActiveVersion: boolean): Promise<void> {
		this._ensureConnected();

		// Resolve the version's data file and confirm it is a previewable, single-file tabular type.
		const meta = await this._client.getPinMeta(pin.guid, bundleId);
		const reader = duckdbReaderForPinType(meta.type);
		if (!reader) {
			throw new Error(`Pins of type '${meta.type}' cannot be previewed in the Data Explorer.`);
		}
		if (Array.isArray(meta.file)) {
			throw new Error('Previewing pins that store multiple files is not supported.');
		}

		const fullName = `${pin.ownerUsername}/${pin.name}`;
		// The Data Explorer tab shows the backend's display_name, so it must be the human-readable pin
		// name, not the synthetic DuckDB table name. Distinguish a specific version from the latest.
		const displayName = isActiveVersion ? fullName : `${fullName} (#${bundleId})`;

		// Download the data file into the cache (immutable-skip if already present).
		const destPath = this._cache.filePath(this._client.serverUrl, pin.guid, bundleId, meta.file);
		if (!this._cache.has(destPath)) {
			await this._downloadToCache(pin.guid, bundleId, meta.file, meta.fileSize, destPath, displayName);
		}

		// The metadata and download above are awaited, so a disconnect may have completed in the
		// meantime. Bail before spinning up a worker or opening an explorer: disconnect's cleanup has
		// already run and will not run again, so anything created past this point would leak. The
		// download stays cached (harmless). Aborting quietly, since the user chose to disconnect.
		if (this._disconnected) {
			return;
		}

		// Load the file into the in-memory database as a table (materialized for fast repeated
		// queries and a stable row order), then register and open the Data Explorer view.
		const worker = this._ensureWorker();
		const tableName = previewTableName(pin.guid, bundleId);
		await worker.runQuery(`CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM ${reader}('${quoteSqlLiteral(destPath)}')`);

		const datasetId = `pinsconn:${this._connectionId}:${pin.guid}:${bundleId}`;
		const codeGenerator = createPinReadCodeGenerator({
			serverUrl: this._client.serverUrl,
			fullName,
			// The active version reads as the latest; only pin an explicit version for the others.
			version: isActiveVersion ? undefined : bundleId,
		});
		await this._dataExplorerHandler.openTableView(datasetId, worker, 'main', tableName, 'table', {
			displayName,
			codeGenerator,
			// When the user closes this preview's tab, reclaim its memory instead of waiting for the
			// whole connection to disconnect.
			onClose: () => this._releasePreview(datasetId, tableName),
		});
		this._openedDatasets.add(datasetId);

		// Re-check after the async view build: a disconnect in that window already tore down the worker
		// and any views it knew about, but not this dataset (registered just above). Undo the
		// registration and bail rather than opening an explorer backed by a disposed worker.
		if (this._disconnected) {
			this._dataExplorerHandler.closeTableView(datasetId);
			this._openedDatasets.delete(datasetId);
			return;
		}

		this._logger.info(`Opening ${displayName} in the Data Explorer`);
		await positron.dataExplorer.open({ providerId: PINS_DATA_EXPLORER_PROVIDER_ID, datasetId, displayName });
	}

	/** Marks the connection disconnected, releases previewed views, and closes the DuckDB worker. */
	async disconnect(): Promise<void> {
		this._disconnected = true;
		this._typeCache.clear();
		for (const datasetId of this._openedDatasets) {
			this._dataExplorerHandler.closeTableView(datasetId);
		}
		this._openedDatasets.clear();
		this._worker?.dispose();
		this._worker = undefined;
	}

	// Downloads a pin's data file into the cache, showing a progress notification only when the file
	// is large enough that the download is likely to take a noticeable moment. Smaller downloads stay
	// quiet and rely on the tree row's spinner.
	private async _downloadToCache(guid: string, bundleId: string, filename: string, fileSize: number | undefined, destPath: string, displayName: string): Promise<void> {
		const download = () => this._client.downloadPinFile(guid, bundleId, filename, destPath);
		if (fileSize === undefined || fileSize < DOWNLOAD_PROGRESS_MIN_BYTES) {
			await download();
			return;
		}
		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Downloading {0}...', displayName) },
			() => download()
		);
	}

	// Releases a previewed dataset when its Data Explorer tab is closed: drops the materialized table
	// to reclaim its memory, and disposes the worker once no previews remain (it respawns lazily on the
	// next preview). A no-op if the dataset was already released (e.g. the connection disconnected
	// first), so a late tab-close after disconnect can't touch a torn-down worker.
	private _releasePreview(datasetId: string, tableName: string): void {
		if (!this._openedDatasets.delete(datasetId)) {
			return;
		}
		if (this._openedDatasets.size === 0) {
			// Last preview closed: drop the whole in-memory database by disposing the worker.
			this._worker?.dispose();
			this._worker = undefined;
		} else {
			// Other previews still share the worker; drop just this table.
			void this._worker?.runQuery(`DROP TABLE IF EXISTS "${tableName}"`).catch(() => { });
		}
	}

	// Lazily creates the in-memory DuckDB worker that backs this connection's previews. The worker
	// process is spawned by the client on its first query, so nothing is forked until a pin is
	// actually previewed.
	private _ensureWorker(): DuckDBWorkerClient {
		if (!this._worker) {
			// Each connection gets its OWN worker, deliberately NOT the shared duckDBWorkerPool. The
			// pool keys workers by database path to share one worker per file (DuckDB's exclusive file
			// lock); every connection here opens ':memory:', so pooling would key them all to the same
			// entry and pile every connection's previewed tables into one shared in-memory database.
			// A private worker per connection keeps each connection's tables isolated.
			//
			// Tradeoff of an in-memory database: if the worker crashes (e.g. a query exhausts memory),
			// the client respawns it on the next query but the respawn is empty, so tables loaded before
			// the crash are gone and any open previews for this connection error until re-opened. This is
			// accepted for a preview feature: unlike the file-backed DuckDB driver (which reopens its
			// file on respawn), a pin preview has no durable database to reopen, and the crash trigger --
			// a pin too large to fit in memory -- could not have been previewed anyway. Re-preview
			// reloads the data.
			this._worker = new DuckDBWorkerClient({ databasePath: ':memory:', readOnly: false });
		}
		return this._worker;
	}

	/** Whether the connection is still usable. */
	async isConnected(): Promise<boolean> {
		return !this._disconnected;
	}

	/** Throws if the connection has been disconnected. */
	private _ensureConnected(): void {
		if (this._disconnected) {
			throw new Error('Connection is closed');
		}
	}
}
