/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';

/**
 * A stub PostgreSQL connection implementing the DataConnection interface.
 * This is placeholder code -- no real PostgreSQL connection is established.
 * Returns mock schema data for testing the driver registration and UI wiring.
 */
export class PostgreSQLConnection implements positron.DataConnection {
	// Whether this connection has been disconnected.
	private _connected = true;

	/**
	 * Constructor.
	 * @param _host The PostgreSQL host.
	 * @param _port The PostgreSQL port.
	 * @param _database The database name.
	 * @param _user The user name.
	 * @param _password The password.
	 */
	constructor(
		private readonly _host: string,
		private readonly _port: number,
		private readonly _database: string,
		private readonly _user: string,
		private readonly _password: string,
	) { }

	/** Returns whether this connection is read-only. Stub always returns false. */
	async isReadOnly(): Promise<boolean> {
		return false;
	}

	/** Returns stub top-level children (mock tables). */
	async getChildren(): Promise<positron.DataConnectionNode[]> {
		this._ensureConnected();

		// Return mock schema data for UI testing.
		return [
			{
				name: 'users',
				kind: positron.DataConnectionNodeKind.Table,
				getChildren: () => Promise.resolve([
					{ name: 'id', kind: positron.DataConnectionNodeKind.Field, dataType: 'integer' },
					{ name: 'name', kind: positron.DataConnectionNodeKind.Field, dataType: 'text' },
					{ name: 'email', kind: positron.DataConnectionNodeKind.Field, dataType: 'text' },
				]),
			},
			{
				name: 'orders',
				kind: positron.DataConnectionNodeKind.Table,
				getChildren: () => Promise.resolve([
					{ name: 'id', kind: positron.DataConnectionNodeKind.Field, dataType: 'integer' },
					{ name: 'user_id', kind: positron.DataConnectionNodeKind.Field, dataType: 'integer' },
					{ name: 'total', kind: positron.DataConnectionNodeKind.Field, dataType: 'numeric' },
				]),
			},
		];
	}

	/** Marks the connection as disconnected. */
	async disconnect(): Promise<void> {
		this._connected = false;
	}

	/** Returns whether the connection is still active. */
	async isConnected(): Promise<boolean> {
		return this._connected;
	}

	// Throws if the connection has been disconnected.
	private _ensureConnected(): void {
		if (!this._connected) {
			throw new Error('PostgreSQL connection is closed');
		}
	}
}
