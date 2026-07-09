/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { basename } from '../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IDataConnectionInstance } from '../../../services/positronDataConnections/common/interfaces/dataConnectionInstance.js';
import { IDataConnectionDriver, IDataConnectionProfile } from '../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IPositronDataConnectionsService } from '../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';

/**
 * How long to wait for the driver extension to register its driver before giving up. Drivers
 * activate on startup, so this only matters when a database file is restored/opened before
 * activation completes.
 */
const DRIVER_WAIT_TIMEOUT_MS = 10000;

/**
 * Builds a data connection profile for a database file opened with the given driver. Shared by the
 * editor input (for its ephemeral connection) and the "Create Data Connection" action (for a
 * persistent, saved connection).
 * @param id The profile id.
 * @param driver The data connection driver.
 * @param resource The database file resource.
 */
export function databaseConnectionProfile(id: string, driver: IDataConnectionDriver, resource: URI): IDataConnectionProfile {
	return {
		id,
		driverMetadata: {
			id: driver.metadata.id,
			name: driver.metadata.name,
			iconSvg: driver.metadata.iconSvg,
			supportedLanguageIds: driver.metadata.supportedLanguageIds,
		},
		connectionName: basename(resource),
		mechanismId: 'file',
		parameterValues: { databasePath: resource.fsPath, readOnly: false },
	};
}

/**
 * PositronDatabaseEditorInput. Opens a database file (DuckDB / SQLite) as a browsable connection:
 * a single-database schema tree on the left and a Data Explorer on the right. The connection is
 * bound to this input's lifetime -- created lazily on first resolve and torn down on dispose.
 */
export class PositronDatabaseEditorInput extends EditorInput {
	//#region Static Properties

	static readonly TypeID: string = 'workbench.input.positronDatabaseEditor';
	static readonly EditorID: string = 'workbench.editor.positronDatabaseEditor';

	//#endregion Static Properties

	//#region Private Properties

	/** The ephemeral profile id for this file's connection. Deterministic so re-opens dedupe. */
	private readonly _profileId: string;

	/** The connection, created once on first resolve. */
	private _connectionPromise?: Promise<IDataConnectionInstance>;

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param resource The database file resource.
	 * @param _driverId The data connection driver id to open the file with.
	 * @param _dataConnectionsService The data connections service.
	 * @param _logService The log service.
	 */
	constructor(
		readonly resource: URI,
		private readonly _driverId: string,
		@IPositronDataConnectionsService private readonly _dataConnectionsService: IPositronDataConnectionsService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._profileId = `positron-database-editor:${resource.toString()}`;
	}

	/** The data connection driver id used to open this file. */
	get driverId(): string {
		return this._driverId;
	}

	/**
	 * Lazily creates (once) an ephemeral connection profile for this database file and connects.
	 * The instance lives as long as this input; {@link dispose} tears it down.
	 */
	resolveConnection(): Promise<IDataConnectionInstance> {
		if (!this._connectionPromise) {
			this._connectionPromise = this._createConnection();
		}
		return this._connectionPromise;
	}

	private async _createConnection(): Promise<IDataConnectionInstance> {
		// Reuse an existing live instance for this profile if one is already open.
		const existing = this._dataConnectionsService.getInstanceForProfile(this._profileId);
		if (existing) {
			return existing;
		}

		const driver = await this._resolveDriver();
		this._dataConnectionsService.addUpdateProfile(databaseConnectionProfile(this._profileId, driver, this.resource));
		return this._dataConnectionsService.connect(this._profileId);
	}

	/**
	 * Resolves this file's data connection driver, waiting for the driver extension to register it
	 * if activation is still in flight. Throws if it does not appear within the timeout.
	 */
	private async _resolveDriver(): Promise<IDataConnectionDriver> {
		const driverManager = this._dataConnectionsService.driverManager;

		const existing = driverManager.getDriver(this._driverId);
		if (existing) {
			return existing;
		}

		const driver = await new Promise<IDataConnectionDriver | undefined>(resolve => {
			const store = new DisposableStore();
			const timeout = setTimeout(() => {
				store.dispose();
				resolve(driverManager.getDriver(this._driverId));
			}, DRIVER_WAIT_TIMEOUT_MS);
			store.add(toDisposable(() => clearTimeout(timeout)));
			store.add(driverManager.onDidChangeDrivers(() => {
				const found = driverManager.getDriver(this._driverId);
				if (found) {
					store.dispose();
					resolve(found);
				}
			}));
		});

		if (!driver) {
			throw new Error(`Data connection driver '${this._driverId}' is not registered.`);
		}
		return driver;
	}

	/**
	 * dispose override. Tears down the ephemeral connection and profile bound to this editor.
	 */
	override dispose(): void {
		if (this._connectionPromise) {
			this._connectionPromise = undefined;
			this._dataConnectionsService.disconnect(this._profileId)
				.catch(err => this._logService.warn(`PositronDatabaseEditorInput: disconnect failed: ${err}`))
				.finally(() => this._dataConnectionsService.removeProfile(this._profileId));
		}
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region AbstractEditorInput Overrides

	override get typeId(): string {
		return PositronDatabaseEditorInput.TypeID;
	}

	override get editorId(): string {
		return PositronDatabaseEditorInput.EditorID;
	}

	override getName(): string {
		return basename(this.resource);
	}

	override getIcon(): ThemeIcon | undefined {
		return ThemeIcon.fromId('database');
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput instanceof PositronDatabaseEditorInput &&
			otherInput.resource.toString() === this.resource.toString();
	}

	//#endregion AbstractEditorInput Overrides
}
