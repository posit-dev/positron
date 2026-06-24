/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client } from 'pg';
import * as positron from 'positron';

/**
 * The capability a table/view/column node needs to open itself in the Data Explorer. Implemented by
 * PostgreSQLConnection, which owns the pg client and the dataset registration.
 */
export interface IPostgresPreviewHost {
	/** Opens the given table or view in the Data Explorer. */
	previewObject(schemaName: string, tableName: string, kind: 'table' | 'view'): Promise<void>;
	/** Opens a single column of the given table or view in the Data Explorer. */
	previewColumn(schemaName: string, tableName: string, kind: 'table' | 'view', columnName: string): Promise<void>;
}

/**
 * Creates the root "Schemas" group node. Lists every non-system schema as a child schema node.
 */
export function createSchemasGroupNode(client: Client, host: IPostgresPreviewHost): positron.DataConnectionNode {
	return {
		name: 'Schemas',
		kind: positron.DataConnectionNodeKind.GroupSchemas,
		async getChildren() {
			const result = await client.query(
				`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast') ORDER BY schema_name`
			);
			return result.rows.map(row => createSchemaNode(client, host, row.schema_name));
		},
	};
}

/**
 * Creates a schema node that expands to two category groups: Tables and Views. Exported so
 * unit tests can construct a schema node directly against a mocked client without having to
 * walk through the root Schemas group.
 */
export function createSchemaNode(client: Client, host: IPostgresPreviewHost, schemaName: string): positron.DataConnectionNode {
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

/**
 * Creates the "Tables" group inside a schema. Lists base tables in the schema.
 */
function createTablesGroupNode(client: Client, host: IPostgresPreviewHost, schemaName: string): positron.DataConnectionNode {
	return {
		name: 'Tables',
		kind: positron.DataConnectionNodeKind.GroupTables,
		async getChildren() {
			const result = await client.query(
				`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`,
				[schemaName]
			);
			return result.rows.map(row => createTableNode(client, host, schemaName, row.table_name));
		},
	};
}

/**
 * Creates the "Views" group inside a schema. Lists views in the schema.
 */
function createViewsGroupNode(client: Client, host: IPostgresPreviewHost, schemaName: string): positron.DataConnectionNode {
	return {
		name: 'Views',
		kind: positron.DataConnectionNodeKind.GroupViews,
		async getChildren() {
			const result = await client.query(
				`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'VIEW' ORDER BY table_name`,
				[schemaName]
			);
			return result.rows.map(row => createViewNode(client, host, schemaName, row.table_name));
		},
	};
}

/**
 * Creates a table node that expands to two category groups: Columns and Indexes.
 */
function createTableNode(
	client: Client,
	host: IPostgresPreviewHost,
	schemaName: string,
	tableName: string
): positron.DataConnectionNode {
	return {
		name: tableName,
		kind: positron.DataConnectionNodeKind.Table,
		async getChildren() {
			return [
				createColumnsGroupNode(client, host, schemaName, tableName, 'table'),
				createIndexesGroupNode(client, schemaName, tableName),
			];
		},
		preview() {
			return host.previewObject(schemaName, tableName, 'table');
		},
	};
}

/**
 * Creates a view node that expands to a single "Columns" group. Views don't have indexes in
 * the schema-browsing sense, so there's only one category under each view.
 */
function createViewNode(
	client: Client,
	host: IPostgresPreviewHost,
	schemaName: string,
	viewName: string
): positron.DataConnectionNode {
	return {
		name: viewName,
		kind: positron.DataConnectionNodeKind.View,
		async getChildren() {
			return [createColumnsGroupNode(client, host, schemaName, viewName, 'view')];
		},
		preview() {
			return host.previewObject(schemaName, viewName, 'view');
		},
	};
}

/**
 * Creates the "Columns" group inside a table or view. Lists column nodes with formatted dataType
 * strings; each column can be previewed as a single-column Data Explorer.
 */
function createColumnsGroupNode(
	client: Client,
	host: IPostgresPreviewHost,
	schemaName: string,
	relationName: string,
	kind: 'table' | 'view'
): positron.DataConnectionNode {
	return {
		name: 'Columns',
		kind: positron.DataConnectionNodeKind.GroupColumns,
		async getChildren() {
			// Primary-key columns (tables only; views have no primary key).
			const primaryKeyColumns = kind === 'table'
				? await getPrimaryKeyColumns(client, schemaName, relationName)
				: new Set<string>();

			const result = await client.query(
				`SELECT column_name, data_type, udt_name, is_nullable, character_maximum_length, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
				[schemaName, relationName]
			);
			return result.rows.map(row => {
				const columnName = row.column_name;
				return {
					name: columnName,
					kind: positron.DataConnectionNodeKind.Field,
					dataType: formatDataType(row),
					isPrimaryKey: primaryKeyColumns.has(columnName),
					preview() {
						return host.previewColumn(schemaName, relationName, kind, columnName);
					},
				};
			});
		},
	};
}

/**
 * Returns the set of column names that make up a table's primary key.
 */
async function getPrimaryKeyColumns(client: Client, schemaName: string, tableName: string): Promise<Set<string>> {
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
 * Creates the "Indexes" group inside a table. Lists indexes as leaf nodes.
 */
function createIndexesGroupNode(
	client: Client,
	schemaName: string,
	tableName: string
): positron.DataConnectionNode {
	return {
		name: 'Indexes',
		kind: positron.DataConnectionNodeKind.GroupIndexes,
		async getChildren() {
			const result = await client.query(
				`SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname`,
				[schemaName, tableName]
			);
			return result.rows.map(row => ({
				name: row.indexname,
				kind: positron.DataConnectionNodeKind.Index,
			}));
		},
	};
}

/**
 * Formats a column's data type into a human-readable string.
 * Uses the udt_name for user-defined types (e.g. arrays) and enriches
 * standard types with length/precision information where available.
 */
function formatDataType(row: {
	data_type: string;
	udt_name: string;
	character_maximum_length: number | null;
	numeric_precision: number | null;
	numeric_scale: number | null;
}): string {
	// Array types are reported as 'ARRAY' with udt_name like '_int4'.
	if (row.data_type === 'ARRAY') {
		return row.udt_name.replace(/^_/, '') + '[]';
	}

	// User-defined types (enums, composites).
	if (row.data_type === 'USER-DEFINED') {
		return row.udt_name;
	}

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
