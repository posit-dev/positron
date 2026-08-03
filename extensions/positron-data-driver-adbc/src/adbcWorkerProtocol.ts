/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Message shapes exchanged between the extension host and the ADBC child process
// (see `adbcWorker.ts`). Messages are sent with Node's "advanced" (V8 structured
// clone) serialization, so values may include bigint and Buffer.

import { IdentifierQuoteSetting } from './adbcDialect.js';

/**
 * Worker open configuration. Passed to the child process via fork argv (JSON
 * encoded) so the worker can load the driver the moment it starts. The fields
 * mirror the ADBC driver manager's own connect options.
 */
export interface WorkerOpenConfig {
	/**
	 * The driver to load: a short name resolved from the ADBC manifest search paths
	 * ('snowflake'), an absolute path to a shared library, a path to a `.toml`
	 * manifest, or a URI whose scheme names the driver ('postgresql://...').
	 * Omitted when `databaseOptions` carries a `uri` or `profile` instead.
	 */
	driver?: string;

	/** The driver's entrypoint symbol. Omitted to let the driver manager guess it. */
	entrypoint?: string;

	/** Driver-specific database options (`uri`, `username`, `password`, vendor keys). */
	databaseOptions: Record<string, string>;

	/** Whether to ask the driver to open the connection read only. */
	readOnly: boolean;

	/**
	 * How to quote identifiers in generated SQL. 'auto' (the default) detects the engine
	 * from what the driver reports; the explicit values are the escape hatch for an engine
	 * the detection has not learned about. Not sent to the worker -- the host builds SQL --
	 * but it travels with the rest of the connection configuration.
	 */
	identifierQuoting?: IdentifierQuoteSetting;
}

/** The depth of metadata to retrieve, mirroring ADBC's ObjectDepth constants. */
export const enum WorkerObjectDepth {
	All = 0,
	Catalogs = 1,
	Schemas = 2,
	Tables = 3,
}

/** Host -> worker: run a SQL query and return its rows. */
export interface WorkerQueryRequest {
	kind: 'query';
	id: number;
	sql: string;
}

/** Host -> worker: retrieve catalog/schema/table/column metadata. */
export interface WorkerObjectsRequest {
	kind: 'objects';
	id: number;
	depth: WorkerObjectDepth;
	catalog?: string;
	dbSchema?: string;
	tableName?: string;
	tableType?: string[];
}

/** Host -> worker: retrieve the Arrow schema of a single table. */
export interface WorkerTableSchemaRequest {
	kind: 'tableSchema';
	id: number;
	catalog?: string;
	dbSchema?: string;
	tableName: string;
}

/**
 * Host -> worker: retrieve the Arrow schema a query would produce, without fetching
 * its rows. Used as the fallback when a driver does not implement GetTableSchema (the
 * Databricks driver, for one, reports it unsupported).
 */
export interface WorkerQuerySchemaRequest {
	kind: 'querySchema';
	id: number;
	sql: string;
}

/** Host -> worker: confirm the driver connection is still usable. */
export interface WorkerPingRequest {
	kind: 'ping';
	id: number;
}

/**
 * Host -> worker: ask the driver what engine it is talking to, used to pick a SQL
 * dialect. GetInfo is optional in the ADBC spec, so the worker answers with whatever the
 * driver supplies and leaves the rest undefined rather than failing.
 */
export interface WorkerInfoRequest {
	kind: 'info';
	id: number;
}

/** Any host -> worker message. */
export type WorkerRequest =
	| WorkerQueryRequest
	| WorkerObjectsRequest
	| WorkerTableSchemaRequest
	| WorkerQuerySchemaRequest
	| WorkerInfoRequest
	| WorkerPingRequest;

/**
 * A column of an ADBC result or table, flattened from the Arrow schema so it can
 * cross the IPC boundary (an Arrow Schema is not structured-cloneable).
 */
export interface WorkerColumnSchema {
	/** The column name. */
	name: string;

	/** The Arrow type rendered as a string, e.g. 'Int64', 'Timestamp<MICROSECOND>'. */
	typeName: string;

	/**
	 * The Arrow type id (the `Type` enum in apache-arrow), used to derive the Data
	 * Explorer display type. Preferred over `typeName` because a single id covers a
	 * family of widths (Int8 and Int64 are both id 2).
	 */
	typeId: number;
}

/**
 * A table found by a metadata request, flattened from ADBC's nested `getObjects`
 * result. Only the fields the schema tree uses are carried across.
 */
export interface WorkerTableInfo {
	name: string;
	/** The vendor's table type, e.g. 'table', 'view', 'BASE TABLE'. */
	tableType: string;
	/** The table's columns, present only when the request asked for full depth. */
	columns?: WorkerColumnInfo[];
	/** The names of the columns making up the primary key, when the driver reports it. */
	primaryKeyColumns?: string[];
}

/** A column found by a full-depth metadata request. */
export interface WorkerColumnInfo {
	name: string;
	/** The vendor's own type name (e.g. 'INTEGER', 'VARCHAR'), when the driver reports it. */
	typeName?: string;
}

/** A schema found by a metadata request. */
export interface WorkerSchemaInfo {
	name: string;
	tables?: WorkerTableInfo[];
}

/** A catalog found by a metadata request. */
export interface WorkerCatalogInfo {
	name: string;
	schemas?: WorkerSchemaInfo[];
}

/** Worker -> host: the result (or error) for the request with the matching `id`. */
export type WorkerResponse =
	| {
		kind: 'rows';
		id: number;
		/** Materialized rows, one plain object per row keyed by column name. */
		rows: Array<Record<string, unknown>>;
	}
	| {
		kind: 'objects';
		id: number;
		catalogs: WorkerCatalogInfo[];
	}
	| {
		kind: 'tableSchema';
		id: number;
		columns: WorkerColumnSchema[];
	}
	| {
		kind: 'info';
		id: number;
		/** ADBC InfoCode.VendorName, when the driver reports it. */
		vendorName?: string;
		/** ADBC InfoCode.DriverName, when the driver reports it. */
		driverName?: string;
	}
	| {
		kind: 'ok';
		id: number;
	}
	| {
		kind: 'error';
		id: number;
		/** Human-readable error message from the driver or the worker. */
		error: string;
		/** The ADBC status code, if any (e.g. 'NOT_FOUND', 'INVALID_ARGUMENT'). */
		code?: string;
		/** The vendor's SQLSTATE, when the driver reports one. */
		sqlState?: string;
	};
