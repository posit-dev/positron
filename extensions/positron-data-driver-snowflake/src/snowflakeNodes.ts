/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Schema-tree node builders for a Snowflake connection. A Snowflake connection can see every database
// the active role can access, so the tree is always cross-database: the root is a "Databases" group,
// and everything under it is browsed through that database's own `"<db>".INFORMATION_SCHEMA` views
// with three-part `"db"."schema"."table"` references.
//
// The databases themselves come from `SHOW TERSE DATABASES`, which needs no current-database context;
// every deeper query is fully qualified with the database name, so it works regardless of which
// database (if any) the session currently has selected. Snowflake does not enforce primary keys (they
// are metadata only, surfaced via SHOW PRIMARY KEYS rather than INFORMATION_SCHEMA), so no primary-key
// detection is attempted and field nodes are never marked as primary keys.

import * as positron from 'positron';
import { SnowflakeClient } from './snowflakeClient.js';

/** Quotes and escapes an identifier for Snowflake by doubling embedded double-quotes. */
function quoteIdentifier(name: string): string {
	return '"' + name.replace(/"/g, '""') + '"';
}

/**
 * The capability a table/view/column node needs to open itself in the Data Explorer. Implemented by
 * SnowflakeConnection, which owns the dataset registration. `client` is the client the node was built
 * against; `database` is the database the object lives in, so previews use a three-part reference.
 */
export interface ISnowflakePreviewHost {
	/** Opens the given table or view in the Data Explorer. */
	previewObject(client: SnowflakeClient, database: string, schemaName: string, tableName: string, kind: 'table' | 'view'): Promise<void>;
	/** Opens a single column of the given table or view in the Data Explorer. */
	previewColumn(client: SnowflakeClient, database: string, schemaName: string, tableName: string, kind: 'table' | 'view', columnName: string): Promise<void>;
}

/**
 * Creates the root "Databases" group node, listing every database the connection's role can access.
 * Uses SHOW TERSE DATABASES so no current-database context is required.
 */
export function createDatabasesGroupNode(client: SnowflakeClient, host: ISnowflakePreviewHost): positron.DataConnectionNode {
	return {
		name: 'Databases',
		kind: positron.DataConnectionNodeKind.GroupDatabases,
		async getChildren() {
			// SHOW returns a row per database with a lowercase `name` column.
			const result = await client.query('SHOW TERSE DATABASES');
			return result.rows
				.map(row => String(row.name))
				.sort((a, b) => a.localeCompare(b))
				.map(name => createDatabaseNode(client, host, name));
		},
	};
}

/**
 * Creates a database node that expands to a single "Schemas" group. Exported so unit tests can
 * construct a database node directly against a mocked client.
 */
export function createDatabaseNode(client: SnowflakeClient, host: ISnowflakePreviewHost, database: string): positron.DataConnectionNode {
	return {
		name: database,
		kind: positron.DataConnectionNodeKind.Database,
		async getChildren() {
			return [createSchemasGroupNode(client, host, database)];
		},
	};
}

/** Creates the "Schemas" group inside a database node, via `"<db>".INFORMATION_SCHEMA.SCHEMATA`. */
export function createSchemasGroupNode(client: SnowflakeClient, host: ISnowflakePreviewHost, database: string): positron.DataConnectionNode {
	return {
		name: 'Schemas',
		kind: positron.DataConnectionNodeKind.GroupSchemas,
		async getChildren() {
			// Every schema is listed, including INFORMATION_SCHEMA -- Snowflake's INFORMATION_SCHEMA is a
			// browsable schema of views (the native Snowflake catalog shows it), not noise to hide.
			const result = await client.query(
				`SELECT SCHEMA_NAME AS "schema_name" FROM ${quoteIdentifier(database)}.INFORMATION_SCHEMA.SCHEMATA ` +
				`ORDER BY SCHEMA_NAME`
			);
			return result.rows.map(row => createSchemaNode(client, host, database, String(row.schema_name)));
		},
	};
}

/**
 * Creates a schema node that expands to Tables and Views groups. Exported so unit tests can construct
 * a schema node directly against a mocked client.
 */
export function createSchemaNode(client: SnowflakeClient, host: ISnowflakePreviewHost, database: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: schemaName,
		kind: positron.DataConnectionNodeKind.Schema,
		async getChildren() {
			return [
				createTablesGroupNode(client, host, database, schemaName),
				createViewsGroupNode(client, host, database, schemaName),
				createStagesGroupNode(client, database, schemaName),
			];
		},
	};
}

/** Creates the "Tables" group inside a schema. Lists base tables via INFORMATION_SCHEMA.TABLES. */
function createTablesGroupNode(client: SnowflakeClient, host: ISnowflakePreviewHost, database: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: 'Tables',
		kind: positron.DataConnectionNodeKind.GroupTables,
		async getChildren() {
			const result = await client.query(
				`SELECT TABLE_NAME AS "table_name" FROM ${quoteIdentifier(database)}.INFORMATION_SCHEMA.TABLES ` +
				`WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
				[schemaName]
			);
			return result.rows.map(row => createRelationNode(client, host, database, schemaName, String(row.table_name), 'table'));
		},
	};
}

/** Creates the "Views" group inside a schema. Lists views via INFORMATION_SCHEMA.TABLES. */
function createViewsGroupNode(client: SnowflakeClient, host: ISnowflakePreviewHost, database: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: 'Views',
		kind: positron.DataConnectionNodeKind.GroupViews,
		async getChildren() {
			const result = await client.query(
				`SELECT TABLE_NAME AS "table_name" FROM ${quoteIdentifier(database)}.INFORMATION_SCHEMA.TABLES ` +
				`WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'VIEW' ORDER BY TABLE_NAME`,
				[schemaName]
			);
			return result.rows.map(row => createRelationNode(client, host, database, schemaName, String(row.table_name), 'view'));
		},
	};
}

/**
 * Creates the "Stages" group inside a schema. Lists named stages via INFORMATION_SCHEMA.STAGES. Stages
 * hold files rather than tabular rows, so stage nodes are leaves: no Data Explorer preview and no
 * children (listing a stage's files is deliberately left for a follow-up). Takes no preview host for
 * that reason.
 */
function createStagesGroupNode(client: SnowflakeClient, database: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: 'Stages',
		kind: positron.DataConnectionNodeKind.GroupStages,
		async getChildren() {
			const result = await client.query(
				`SELECT STAGE_NAME AS "stage_name" FROM ${quoteIdentifier(database)}.INFORMATION_SCHEMA.STAGES ` +
				`WHERE STAGE_SCHEMA = ? ORDER BY STAGE_NAME`,
				[schemaName]
			);
			return result.rows.map(row => ({
				name: String(row.stage_name),
				kind: positron.DataConnectionNodeKind.Stage,
			}));
		},
	};
}

/** Creates a table or view node that expands to a single "Columns" group. */
function createRelationNode(
	client: SnowflakeClient,
	host: ISnowflakePreviewHost,
	database: string,
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
 * Creates the "Columns" group inside a table or view. Columns come from INFORMATION_SCHEMA.COLUMNS.
 * Primary-key detection is intentionally skipped: Snowflake does not enforce primary keys and does not
 * expose them through INFORMATION_SCHEMA.
 */
function createColumnsGroupNode(
	client: SnowflakeClient,
	host: ISnowflakePreviewHost,
	database: string,
	schemaName: string,
	relationName: string,
	kind: 'table' | 'view'
): positron.DataConnectionNode {
	return {
		name: 'Columns',
		kind: positron.DataConnectionNodeKind.GroupColumns,
		async getChildren() {
			const result = await client.query(
				`SELECT COLUMN_NAME AS "column_name", DATA_TYPE AS "data_type", ` +
				`CHARACTER_MAXIMUM_LENGTH AS "character_maximum_length", ` +
				`NUMERIC_PRECISION AS "numeric_precision", NUMERIC_SCALE AS "numeric_scale" ` +
				`FROM ${quoteIdentifier(database)}.INFORMATION_SCHEMA.COLUMNS ` +
				`WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
				[schemaName, relationName]
			);
			return result.rows.map(row => ({
				name: String(row.column_name),
				kind: positron.DataConnectionNodeKind.Field,
				dataType: formatDataType(row),
				// Snowflake does not enforce or expose primary keys via INFORMATION_SCHEMA.
				isPrimaryKey: false,
				preview() {
					return host.previewColumn(client, database, schemaName, relationName, kind, String(row.column_name));
				},
			}));
		},
	};
}

/**
 * Formats a column's data type into a human-readable string, enriching text types with their length
 * and NUMBER types with precision/scale where available. Snowflake reports variable-length text as
 * 'TEXT' and fixed-point numbers as 'NUMBER' in INFORMATION_SCHEMA.COLUMNS.
 */
function formatDataType(row: Record<string, unknown>): string {
	const dataType = String(row.data_type);
	const charLen = row.character_maximum_length;
	const precision = row.numeric_precision;
	const scale = row.numeric_scale;

	// Text types with length, e.g. TEXT(255).
	if (charLen !== null && charLen !== undefined) {
		return `${dataType}(${Number(charLen)})`;
	}

	// NUMBER with precision and scale, e.g. NUMBER(10,2) or NUMBER(38).
	if (dataType.toUpperCase() === 'NUMBER' && precision !== null && precision !== undefined) {
		const p = Number(precision);
		const s = scale === null || scale === undefined ? 0 : Number(scale);
		return s > 0 ? `NUMBER(${p},${s})` : `NUMBER(${p})`;
	}

	return dataType;
}
