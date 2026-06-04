/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client } from 'pg';
import * as positron from 'positron';
import { createSchemasGroupNode } from './postgresqlNodes.js';

/**
 * Connection configuration passed from the driver.
 */
export interface PostgreSQLConnectionConfig {
	host: string;
	port: number;
	database: string;
	user: string;
	password: string;
	ssl: boolean;
	readOnly: boolean;
}

/**
 * A live PostgreSQL connection implementing the DataConnection interface.
 * Connects via the pg Client and provides schema browsing via getChildren().
 */
export class PostgreSQLConnection implements positron.DataConnection {
	// The pg client, or null after disconnect.
	private _client: Client | null;

	/**
	 * Constructor. Call connect() after constructing to establish the connection.
	 * @param _config The connection configuration.
	 */
	constructor(private readonly _config: PostgreSQLConnectionConfig) {
		this._client = new Client({
			host: _config.host,
			port: _config.port,
			database: _config.database,
			user: _config.user,
			password: _config.password,
			ssl: _config.ssl ? { rejectUnauthorized: false } : false,
			options: _config.readOnly ? '-c default_transaction_read_only=on' : undefined,
		});
	}

	/**
	 * Establishes the connection. Must be called before any other method.
	 */
	async connect(): Promise<void> {
		if (!this._client) {
			throw new Error('PostgreSQL connection has been disconnected');
		}
		try {
			await this._client.connect();
		} catch (err: any) {
			this._client = null;
			throw new Error(`Failed to connect to PostgreSQL at ${this._config.host}:${this._config.port}: ${err.message}`);
		}
	}

	/**
	 * Gets a value which indicates whether the connection is read only.
	 */
	async isReadOnly(): Promise<boolean> {
		return this._config.readOnly;
	}

	/**
	 * Returns top-level children: a single "Schemas" group node that lists every non-system
	 * schema. Each schema node can be expanded to show its Tables and Views groups.
	 */
	async getChildren(): Promise<positron.DataConnectionNode[]> {
		this._ensureConnected();
		return [createSchemasGroupNode(this._client!)];
	}

	/** Closes the connection. Idempotent -- safe to call multiple times. */
	async disconnect(): Promise<void> {
		if (this._client) {
			await this._client.end();
			this._client = null;
		}
	}

	/** Checks whether the connection is still open and operational. */
	async isConnected(): Promise<boolean> {
		if (!this._client) {
			return false;
		}
		try {
			await this._client.query('SELECT 1');
			return true;
		} catch {
			return false;
		}
	}

	// Throws if the connection has been disconnected.
	private _ensureConnected(): void {
		if (!this._client) {
			throw new Error('PostgreSQL connection is closed');
		}
	}
}
