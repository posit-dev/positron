/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Message shapes exchanged between the extension host and the ODBC child process (see
// `odbcWorker.ts`). Messages use Node's "advanced" (V8 structured clone) serialization, so values
// may include bigint and Buffer -- both of which ODBC drivers return for large integer and binary
// columns.

/**
 * Worker connect configuration, passed to the child via fork argv (JSON encoded) so it can open
 * the connection the moment it starts.
 */
export interface WorkerConnectConfig {
	/** The full ODBC connection string, e.g. `DSN=Pagila;UID=brian`. */
	connectionString: string;

	/**
	 * Milliseconds to wait for the connection to be established. ODBC's own default is "wait
	 * forever", which would hang the pane on an unreachable server with no way back.
	 */
	connectionTimeout: number;

	/** Milliseconds a single statement may run before the driver aborts it. */
	loginTimeout: number;
}

/** A value that can be bound to a positional (`?`) parameter. */
export type OdbcBindValue = string | number | null;

/** A materialized result row, keyed by column name. */
export type OdbcRow = Record<string, unknown>;

/**
 * Host -> worker. Every request carries an `id` the response echoes back. The worker serializes
 * requests: an ODBC connection handle is not safe to drive from several statements at once, and
 * the driver's behavior when you try is vendor-specific.
 */
export type WorkerRequest =
	| {
		kind: 'query';
		id: number;
		sql: string;
		/** Positional parameters bound to `?` placeholders in the SQL, in order. */
		params?: OdbcBindValue[];
	}
	| {
		// SQLTables. Nulls mean "any"; the empty string means "those with no catalog/schema".
		kind: 'tables';
		id: number;
		catalog: string | null;
		schema: string | null;
		table: string | null;
		/** Comma-separated table types, e.g. `'TABLE,VIEW'`. Null means every type. */
		type: string | null;
	}
	| {
		// SQLColumns.
		kind: 'columns';
		id: number;
		catalog: string | null;
		schema: string | null;
		table: string | null;
		column: string | null;
	}
	| {
		// SQLPrimaryKeys, used to mark primary key columns in the tree.
		kind: 'primaryKeys';
		id: number;
		catalog: string | null;
		schema: string | null;
		table: string;
	}
	| {
		/** Establishes the connection if it is not up yet, and reports whether it is usable. */
		kind: 'ping';
		id: number;
	}
	| {
		kind: 'close';
		id: number;
	};

/** One diagnostic record from the ODBC driver, as node-odbc surfaces them. */
export interface OdbcErrorDetail {
	state?: string;
	code?: number;
	message?: string;
}

/** Worker -> host: the result (or failure) for the request with the matching `id`. */
export type WorkerResponse =
	| {
		kind: 'result';
		id: number;
		rows: OdbcRow[];
	}
	| {
		kind: 'error';
		id: number;
		/** Human-readable message, already flattened from the ODBC diagnostic records. */
		error: string;
		/** The raw ODBC diagnostics, for the driver log. */
		odbcErrors?: OdbcErrorDetail[];
		/**
		 * Set when the failure was the ODBC driver manager itself failing to load, rather than a
		 * connection problem. The host turns this into install guidance instead of a SQL error.
		 */
		driverManagerMissing?: boolean;
	};
