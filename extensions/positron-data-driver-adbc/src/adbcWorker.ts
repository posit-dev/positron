/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// This module is the entry point for the ADBC child process. It owns the ADBC
// driver manager, the vendor driver shared library it loads, and the open
// connection, and serves metadata and query requests on their behalf.
//
// Running ADBC out-of-process matters more here than for the other drivers: this
// is the escape-hatch driver, so the library it dlopen()s is arbitrary
// third-party code chosen by the user. A segfault or abort inside a vendor
// driver cannot be caught in-process, so isolating it in a child is the only way
// to keep the extension host alive -- the host sees the exit, fails the in-flight
// request, and respawns.

import {
	WorkerCatalogInfo,
	WorkerColumnSchema,
	WorkerOpenConfig,
	WorkerRequest,
	WorkerResponse,
	WorkerTableInfo,
} from './adbcWorkerProtocol';

// --- Structural types for the ADBC driver manager ---
//
// @apache-arrow/adbc-driver-manager is ESM-only and loaded dynamically (see
// importAdbc), so it cannot be imported for its types in this CommonJS module.
// Only the small slice of its surface used below is described here; the shapes
// come from the package's own d.ts.

/** An Arrow field, as exposed by an Arrow Schema. */
interface ArrowField {
	name: string;
	type: { typeId: number };
}

/** An Arrow schema, as returned by getTableSchema. */
interface ArrowSchema {
	fields: ArrowField[];
}

/** An Arrow table, as returned by query and the metadata calls. */
interface ArrowTable {
	schema: ArrowSchema;
	toArray(): Array<{ toJSON(): Record<string, unknown> }>;
}

/** The slice of AdbcConnection this worker uses. */
interface AdbcConnectionLike {
	setReadOnly(enabled: boolean): void;
	getInfo(infoCodes?: number[]): Promise<ArrowTable>;
	query(sql: string): Promise<ArrowTable>;
	getObjects(options: {
		depth?: number;
		catalog?: string;
		dbSchema?: string;
		tableName?: string;
		tableType?: string[];
	}): Promise<ArrowTable>;
	getTableSchema(options: { catalog?: string; dbSchema?: string; tableName: string }): Promise<ArrowSchema>;
	close(): Promise<void>;
}

/** The slice of AdbcDatabase this worker uses. */
interface AdbcDatabaseLike {
	connect(): Promise<AdbcConnectionLike>;
	close(): Promise<void>;
}

/** The slice of the driver manager module this worker uses. */
interface AdbcModule {
	AdbcDatabase: new (options: {
		driver?: string;
		entrypoint?: string;
		databaseOptions?: Record<string, string>;
	}) => AdbcDatabaseLike;
}

/**
 * Imports the ESM-only driver manager from this CommonJS module.
 *
 * A bare `import()` is not enough: both esbuild (which bundles this worker to
 * CJS) and TypeScript would be free to rewrite it into a `require()`, which
 * throws ERR_REQUIRE_ESM for a package with `"type": "module"`. Hiding the
 * specifier behind `new Function` puts it beyond the reach of either compiler,
 * so a genuine dynamic import survives into the emitted JavaScript.
 */
const importAdbc: () => Promise<AdbcModule> =
	new Function('return import("@apache-arrow/adbc-driver-manager")') as () => Promise<AdbcModule>;

/** Send a response to the host, narrowed so TypeScript knows IPC is available. */
function send(response: WorkerResponse): void {
	process.send?.(response);
}

/** The open configuration, supplied by the host as the first fork argument. */
const config: WorkerOpenConfig = JSON.parse(process.argv[2] ?? '{}');

let connection: AdbcConnectionLike | undefined;
let database: AdbcDatabaseLike | undefined;

/**
 * Opens the driver and connection. Awaited by every request, so a failure to
 * load the driver is reported against the request that provoked it rather than
 * lost at startup. The promise is created eagerly so the driver loads while the
 * host is still setting up.
 */
const ready: Promise<void> = (async () => {
	const { AdbcDatabase } = await importAdbc();
	database = new AdbcDatabase({
		driver: config.driver,
		entrypoint: config.entrypoint,
		databaseOptions: config.databaseOptions,
	});
	const opened = await database.connect();
	if (config.readOnly) {
		// Not every driver implements the read-only option; a driver that rejects it
		// still yields a usable (read/write) connection, which is preferable to
		// failing the connection outright.
		try {
			opened.setReadOnly(true);
		} catch {
			// The driver does not support read-only connections.
		}
	}
	connection = opened;
})();

// Surface a driver that fails to load as a rejected request rather than an
// unhandled rejection that would tear down the worker before the host can ask.
ready.catch(() => { /* reported per-request by requireConnection */ });

/** Resolves the open connection, or throws the error that prevented opening it. */
async function requireConnection(): Promise<AdbcConnectionLike> {
	await ready;
	if (!connection) {
		throw new Error('The ADBC connection is not open');
	}
	return connection;
}

/**
 * Converts a single Arrow cell into a value that survives structured-clone IPC.
 * Numbers, strings, booleans, bigints, and Dates cross unchanged; binary becomes
 * a Buffer; anything else (nested lists, structs, decimals) is rendered as JSON
 * so the Data Explorer can display it as text.
 */
function normalizeValue(value: unknown): unknown {
	if (value === null || value === undefined) {
		return null;
	}
	switch (typeof value) {
		case 'number':
		case 'string':
		case 'boolean':
		case 'bigint':
			return value;
		default:
			break;
	}
	if (value instanceof Date) {
		return value;
	}
	if (value instanceof Uint8Array) {
		return Buffer.from(value);
	}
	return jsonStringify(value);
}

/** JSON-stringifies a value, rendering bigints as strings and tolerating cycles. */
function jsonStringify(value: unknown): string {
	try {
		return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)) ?? String(value);
	} catch {
		return String(value);
	}
}

/** Materializes an Arrow table into plain, clone-safe rows keyed by column name. */
function toRows(table: ArrowTable): Array<Record<string, unknown>> {
	return table.toArray().map(row => {
		const source = row.toJSON();
		const result: Record<string, unknown> = {};
		for (const key of Object.keys(source)) {
			result[key] = normalizeValue(source[key]);
		}
		return result;
	});
}

/**
 * Converts an Arrow metadata table into plain JavaScript. ADBC's getObjects
 * result is deeply nested (catalogs -> schemas -> tables -> columns), and the
 * nested values are Arrow vectors rather than arrays, so a JSON round trip is
 * the reliable way to flatten the whole structure at once.
 */
function toPlainRows(table: ArrowTable): Array<Record<string, any>> {
	return JSON.parse(jsonStringify(table.toArray().map(row => row.toJSON())));
}

/** The shape of one entry in ADBC's `table_constraints` metadata list. */
interface RawConstraint {
	constraint_type?: string | null;
	constraint_column_names?: string[] | null;
}

/** Extracts the primary-key column names from a table's ADBC constraint list. */
function primaryKeyColumns(constraints: RawConstraint[] | null | undefined): string[] | undefined {
	const primaryKey = (constraints ?? []).find(
		constraint => (constraint.constraint_type ?? '').toUpperCase() === 'PRIMARY KEY');
	return primaryKey?.constraint_column_names ?? undefined;
}

/** Flattens ADBC's nested getObjects result into the worker protocol's shape. */
function toCatalogs(table: ArrowTable): WorkerCatalogInfo[] {
	return toPlainRows(table).map(catalog => ({
		name: catalog.catalog_name ?? '',
		schemas: catalog.catalog_db_schemas === null || catalog.catalog_db_schemas === undefined
			? undefined
			: catalog.catalog_db_schemas.map((schema: any) => ({
				name: schema.db_schema_name ?? '',
				tables: schema.db_schema_tables === null || schema.db_schema_tables === undefined
					? undefined
					: schema.db_schema_tables.map((table: any): WorkerTableInfo => ({
						name: table.table_name ?? '',
						tableType: table.table_type ?? '',
						columns: table.table_columns === null || table.table_columns === undefined
							? undefined
							: table.table_columns.map((column: any) => ({
								name: column.column_name ?? '',
								typeName: column.xdbc_type_name ?? undefined,
							})),
						primaryKeyColumns: primaryKeyColumns(table.table_constraints),
					})),
			})),
	}));
}

/** Flattens an Arrow schema into the worker protocol's column list. */
function toColumnSchemas(schema: ArrowSchema): WorkerColumnSchema[] {
	return schema.fields.map(field => ({
		name: field.name,
		typeName: String(field.type),
		typeId: field.type.typeId,
	}));
}

/** Handles one request, producing the response to send back. */
async function handle(request: WorkerRequest): Promise<WorkerResponse> {
	const conn = await requireConnection();
	switch (request.kind) {
		case 'query':
			return { kind: 'rows', id: request.id, rows: toRows(await conn.query(request.sql)) };
		case 'objects': {
			const table = await conn.getObjects({
				depth: request.depth,
				catalog: request.catalog,
				dbSchema: request.dbSchema,
				tableName: request.tableName,
				tableType: request.tableType,
			});
			return { kind: 'objects', id: request.id, catalogs: toCatalogs(table) };
		}
		case 'tableSchema': {
			const schema = await conn.getTableSchema({
				catalog: request.catalog,
				dbSchema: request.dbSchema,
				tableName: request.tableName,
			});
			return { kind: 'tableSchema', id: request.id, columns: toColumnSchemas(schema) };
		}
		case 'querySchema': {
			// The query is written to match no rows, so this costs a plan but no scan; the
			// result's Arrow schema is what we are after.
			const table = await conn.query(request.sql);
			return { kind: 'tableSchema', id: request.id, columns: toColumnSchemas(table.schema) };
		}
		case 'info':
			return { kind: 'info', id: request.id, ...(await readVendorInfo(conn)) };
		case 'ping':
			return { kind: 'ok', id: request.id };
	}
}

/** ADBC InfoCode values for the two fields the dialect detection uses. */
const INFO_VENDOR_NAME = 0;
const INFO_DRIVER_NAME = 100;

/**
 * Reads the vendor and driver names via GetInfo. The call is optional in the ADBC spec,
 * so a driver that does not implement it yields an empty result rather than an error --
 * dialect detection then falls back to the configured driver string.
 */
async function readVendorInfo(conn: AdbcConnectionLike): Promise<{ vendorName?: string; driverName?: string }> {
	try {
		const table = await conn.getInfo([INFO_VENDOR_NAME, INFO_DRIVER_NAME]);
		const result: { vendorName?: string; driverName?: string } = {};
		for (const row of toPlainRows(table)) {
			// info_value is a union column; a JSON round trip renders the string variant
			// directly, so accept either a bare string or a wrapped one.
			const value = typeof row.info_value === 'string'
				? row.info_value
				: (row.info_value && typeof row.info_value === 'object'
					? Object.values(row.info_value).find(v => typeof v === 'string')
					: undefined);
			if (typeof value !== 'string') {
				continue;
			}
			if (Number(row.info_name) === INFO_VENDOR_NAME) {
				result.vendorName = value;
			} else if (Number(row.info_name) === INFO_DRIVER_NAME) {
				result.driverName = value;
			}
		}
		return result;
	} catch {
		// The driver does not implement GetInfo.
		return {};
	}
}

/**
 * Requests are serialized: ADBC statements are executed against a single
 * connection, and drivers make no guarantee about concurrent use of one
 * connection handle, so each request completes before the next begins.
 */
let queue: Promise<void> = Promise.resolve();

process.on('message', (request: WorkerRequest) => {
	queue = queue.then(async () => {
		try {
			send(await handle(request));
		} catch (error) {
			// AdbcError carries a status code and (sometimes) a vendor SQLSTATE.
			const err = error as { message?: string; code?: string; sqlState?: string };
			send({
				kind: 'error',
				id: request.id,
				error: err?.message ?? String(error),
				code: err?.code,
				sqlState: err?.sqlState,
			});
		}
	});
});

// If the host goes away, close the driver handles and exit cleanly. Closing the
// connection gives the vendor driver a chance to release its own resources
// (network sockets, auth tokens) rather than being killed mid-session.
process.on('disconnect', () => {
	void (async () => {
		try {
			await connection?.close();
			await database?.close();
		} catch {
			// The connection is already gone; nothing more to release.
		}
		process.exit(0);
	})();
});
