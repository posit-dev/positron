/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Schema-tree node builders for a Redshift connection. There are two families:
//
//   - Single-database (the default): the connection is scoped to one database, browsed via
//     information_schema with two-part `"schema"."table"` references. Redshift tables have no
//     indexes (they use sort/distribution keys), so no "Indexes" group is offered.
//
//   - Cross-database: on RA3 clusters and Redshift Serverless, a single connection can see every
//     database in the namespace. When the connection detects that capability, the tree gains a
//     top-level "Databases" group. Those nodes browse via the SVV_ALL_* catalog views (which carry
//     a database_name column) and preview with three-part `"db"."schema"."table"` references, all
//     over the same connection -- no per-database reconnect (unlike the Postgres driver).
//
// A `database` of `undefined` throughout means "the connected database" (single-database family);
// a defined `database` means a specific database browsed cross-database.

import * as positron from 'positron';
import { RedshiftClient } from './redshiftClient.js';

// System schemas hidden from the tree in both families.
const SYSTEM_SCHEMAS = ['pg_catalog', 'information_schema', 'pg_toast', 'pg_internal', 'catalog_history'];
const SYSTEM_SCHEMAS_SQL = SYSTEM_SCHEMAS.map(s => `'${s}'`).join(', ');

/**
 * The capability a table/view/column node needs to open itself in the Data Explorer. Implemented by
 * RedshiftConnection, which owns the dataset registration. `client` is the client the node was
 * built against; `database` is the database the object lives in (undefined for the connected
 * database in single-database mode), so cross-database previews use a three-part reference.
 */
export interface IRedshiftPreviewHost {
	/** Opens the given table or view in the Data Explorer. */
	previewObject(client: RedshiftClient, database: string | undefined, schemaName: string, tableName: string, kind: 'table' | 'view'): Promise<void>;
	/** Opens a single column of the given table or view in the Data Explorer. */
	previewColumn(client: RedshiftClient, database: string | undefined, schemaName: string, tableName: string, kind: 'table' | 'view', columnName: string): Promise<void>;
}

// --- Single-database family (connected database, information_schema) ---

/**
 * Creates the root "Schemas" group node for the connected database. Lists every non-system schema
 * as a child schema node.
 */
export function createSchemasGroupNode(client: RedshiftClient, host: IRedshiftPreviewHost): positron.DataConnectionNode {
	return {
		name: 'Schemas',
		kind: positron.DataConnectionNodeKind.GroupSchemas,
		async getChildren() {
			const result = await client.query(
				`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN (${SYSTEM_SCHEMAS_SQL}) ORDER BY schema_name`
			);
			return result.rows.map(row => createSchemaNode(client, host, row.schema_name));
		},
	};
}

/**
 * Creates a schema node in the connected database that expands to Tables and Views groups. Exported
 * so unit tests can construct a schema node directly against a mocked client.
 */
export function createSchemaNode(client: RedshiftClient, host: IRedshiftPreviewHost, schemaName: string): positron.DataConnectionNode {
	return {
		name: schemaName,
		kind: positron.DataConnectionNodeKind.Schema,
		async getChildren() {
			return [
				createTablesGroupNode(client, host, schemaName),
				createViewsGroupNode(client, host, schemaName),
			];
		},
	};
}

/** Creates the "Tables" group inside a connected-database schema. Lists base tables. */
function createTablesGroupNode(client: RedshiftClient, host: IRedshiftPreviewHost, schemaName: string): positron.DataConnectionNode {
	return {
		name: 'Tables',
		kind: positron.DataConnectionNodeKind.GroupTables,
		async getChildren() {
			const result = await client.query(
				`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`,
				[schemaName]
			);
			return result.rows.map(row => createRelationNode(client, host, undefined, schemaName, row.table_name, 'table'));
		},
	};
}

/** Creates the "Views" group inside a connected-database schema. Lists views. */
function createViewsGroupNode(client: RedshiftClient, host: IRedshiftPreviewHost, schemaName: string): positron.DataConnectionNode {
	return {
		name: 'Views',
		kind: positron.DataConnectionNodeKind.GroupViews,
		async getChildren() {
			const result = await client.query(
				`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'VIEW' ORDER BY table_name`,
				[schemaName]
			);
			return result.rows.map(row => createRelationNode(client, host, undefined, schemaName, row.table_name, 'view'));
		},
	};
}

// --- Cross-database family (SVV_ALL_* catalog views) ---

/**
 * Creates the root "Databases" group node, used when the connection supports cross-database queries.
 * Lists every database visible from the connection.
 */
export function createDatabasesGroupNode(client: RedshiftClient, host: IRedshiftPreviewHost): positron.DataConnectionNode {
	return {
		name: 'Databases',
		kind: positron.DataConnectionNodeKind.GroupDatabases,
		async getChildren() {
			const result = await client.query(
				`SELECT database_name FROM SVV_REDSHIFT_DATABASES ORDER BY database_name`
			);
			return result.rows.map(row => createDatabaseNode(client, host, row.database_name));
		},
	};
}

/**
 * Creates a database node that expands to a "Schemas" group browsed cross-database. Exported so unit
 * tests can construct a database node directly against a mocked client.
 */
export function createDatabaseNode(client: RedshiftClient, host: IRedshiftPreviewHost, database: string): positron.DataConnectionNode {
	return {
		name: database,
		kind: positron.DataConnectionNodeKind.Database,
		async getChildren() {
			return [createCrossDatabaseSchemasGroupNode(client, host, database)];
		},
	};
}

/** Creates the "Schemas" group inside a database node, via SVV_ALL_SCHEMAS. */
function createCrossDatabaseSchemasGroupNode(client: RedshiftClient, host: IRedshiftPreviewHost, database: string): positron.DataConnectionNode {
	return {
		name: 'Schemas',
		kind: positron.DataConnectionNodeKind.GroupSchemas,
		async getChildren() {
			const result = await client.query(
				`SELECT schema_name FROM SVV_ALL_SCHEMAS WHERE database_name = $1 AND schema_name NOT IN (${SYSTEM_SCHEMAS_SQL}) ORDER BY schema_name`,
				[database]
			);
			return result.rows.map(row => createCrossDatabaseSchemaNode(client, host, database, row.schema_name));
		},
	};
}

/** Creates a cross-database schema node that expands to Tables and Views groups, via SVV_ALL_TABLES. */
function createCrossDatabaseSchemaNode(client: RedshiftClient, host: IRedshiftPreviewHost, database: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: schemaName,
		kind: positron.DataConnectionNodeKind.Schema,
		async getChildren() {
			return [
				createCrossDatabaseTablesGroupNode(client, host, database, schemaName),
				createCrossDatabaseViewsGroupNode(client, host, database, schemaName),
			];
		},
	};
}

/**
 * Creates the "Tables" group inside a cross-database schema. SVV_ALL_TABLES.table_type is matched
 * case-insensitively; anything that is not a view is treated as a table so external tables aren't
 * hidden.
 */
function createCrossDatabaseTablesGroupNode(client: RedshiftClient, host: IRedshiftPreviewHost, database: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: 'Tables',
		kind: positron.DataConnectionNodeKind.GroupTables,
		async getChildren() {
			const result = await client.query(
				`SELECT table_name FROM SVV_ALL_TABLES WHERE database_name = $1 AND schema_name = $2 AND UPPER(table_type) <> 'VIEW' ORDER BY table_name`,
				[database, schemaName]
			);
			return result.rows.map(row => createRelationNode(client, host, database, schemaName, row.table_name, 'table'));
		},
	};
}

/** Creates the "Views" group inside a cross-database schema, via SVV_ALL_TABLES. */
function createCrossDatabaseViewsGroupNode(client: RedshiftClient, host: IRedshiftPreviewHost, database: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: 'Views',
		kind: positron.DataConnectionNodeKind.GroupViews,
		async getChildren() {
			const result = await client.query(
				`SELECT table_name FROM SVV_ALL_TABLES WHERE database_name = $1 AND schema_name = $2 AND UPPER(table_type) = 'VIEW' ORDER BY table_name`,
				[database, schemaName]
			);
			return result.rows.map(row => createRelationNode(client, host, database, schemaName, row.table_name, 'view'));
		},
	};
}

// --- Shared relation (table/view) and column nodes ---

/**
 * Creates a table or view node that expands to a single "Columns" group. `database` is undefined in
 * single-database mode and a database name in cross-database mode; it selects the column source and
 * the preview reference (two-part vs three-part).
 */
function createRelationNode(
	client: RedshiftClient,
	host: IRedshiftPreviewHost,
	database: string | undefined,
	schemaName: string,
	relationName: string,
	kind: 'table' | 'view'
): positron.DataConnectionNode {
	return {
		name: relationName,
		kind: kind === 'table' ? positron.DataConnectionNodeKind.Table : positron.DataConnectionNodeKind.View,
		async getChildren() {
			return [createColumnsGroupNode(client, host, database, schemaName, relationName, kind)];
		},
		preview() {
			return host.previewObject(client, database, schemaName, relationName, kind);
		},
	};
}

/**
 * Creates the "Columns" group inside a table or view. In single-database mode columns come from
 * information_schema (and declared primary keys are detected); in cross-database mode they come from
 * SVV_ALL_COLUMNS (primary-key detection is skipped, as the constraint views are per-connected-database).
 */
function createColumnsGroupNode(
	client: RedshiftClient,
	host: IRedshiftPreviewHost,
	database: string | undefined,
	schemaName: string,
	relationName: string,
	kind: 'table' | 'view'
): positron.DataConnectionNode {
	return {
		name: 'Columns',
		kind: positron.DataConnectionNodeKind.GroupColumns,
		async getChildren() {
			// Primary-key columns (single-database tables only). Redshift does not enforce primary
			// keys, but honors declared ones as metadata, which information_schema exposes.
			const primaryKeyColumns = database === undefined && kind === 'table'
				? await getPrimaryKeyColumns(client, schemaName, relationName)
				: new Set<string>();

			const result = database === undefined
				? await client.query(
					`SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
					[schemaName, relationName]
				)
				: await client.query(
					`SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale FROM SVV_ALL_COLUMNS WHERE database_name = $1 AND schema_name = $2 AND table_name = $3 ORDER BY ordinal_position`,
					[database, schemaName, relationName]
				);
			return result.rows.map(row => {
				const columnName = row.column_name;
				return {
					name: columnName,
					kind: positron.DataConnectionNodeKind.Field,
					dataType: formatDataType(row),
					isPrimaryKey: primaryKeyColumns.has(columnName),
					preview() {
						return host.previewColumn(client, database, schemaName, relationName, kind, columnName);
					},
				};
			});
		},
	};
}

/** Returns the set of column names that make up a table's declared primary key (connected database). */
async function getPrimaryKeyColumns(client: RedshiftClient, schemaName: string, tableName: string): Promise<Set<string>> {
	const result = await client.query(
		`SELECT kcu.column_name FROM information_schema.table_constraints tc ` +
		`JOIN information_schema.key_column_usage kcu ` +
		`ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema ` +
		`WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
		[schemaName, tableName]
	);
	return new Set(result.rows.map(row => row.column_name));
}

/**
 * Formats a column's data type into a human-readable string, enriching character and numeric types
 * with length/precision information where available.
 */
function formatDataType(row: {
	data_type: string;
	character_maximum_length: number | null;
	numeric_precision: number | null;
	numeric_scale: number | null;
}): string {
	// Character types with length.
	if (row.character_maximum_length !== null) {
		return `${row.data_type}(${row.character_maximum_length})`;
	}

	// Numeric types with precision and scale.
	if (row.data_type === 'numeric' && row.numeric_precision !== null) {
		if (row.numeric_scale !== null && row.numeric_scale > 0) {
			return `numeric(${row.numeric_precision},${row.numeric_scale})`;
		}
		return `numeric(${row.numeric_precision})`;
	}

	return row.data_type;
}
