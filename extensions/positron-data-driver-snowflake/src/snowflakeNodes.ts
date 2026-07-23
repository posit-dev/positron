/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Schema-tree node builders for a Snowflake connection. A Snowflake connection can see every database
// the active role can access, so the tree is always cross-database: the root is a "Databases" group,
// and everything under it is enumerated with SHOW/DESCRIBE metadata commands.
//
// Browsing deliberately uses SHOW (SHOW TERSE DATABASES / SCHEMAS / TABLES / VIEWS, SHOW STAGES) and
// DESCRIBE rather than SELECTs against INFORMATION_SCHEMA. INFORMATION_SCHEMA views require an active
// warehouse (compute), so querying them fails with "No active warehouse selected in the current
// session" whenever the connection has no warehouse -- and warehouse is an optional connection field.
// SHOW/DESCRIBE run on the cloud-services layer and need no warehouse, so the tree expands regardless.
// (Previewing data in the Data Explorer still needs a warehouse, since that runs a real SELECT.) Each
// command is scoped by fully-qualified object name, so it works no matter which database or schema the
// session currently has selected. Snowflake does not enforce primary keys, so no primary-key detection
// is attempted and field nodes are never marked as primary keys.

import * as positron from 'positron';
import { SnowflakeClient } from './snowflakeClient.js';

/** Quotes and escapes an identifier for Snowflake by doubling embedded double-quotes. */
function quoteIdentifier(name: string): string {
	return '"' + name.replace(/"/g, '""') + '"';
}

/** Builds a double-quoted two-part `"<db>"."<schema>"` reference. */
function schemaRef(database: string, schemaName: string): string {
	return `${quoteIdentifier(database)}.${quoteIdentifier(schemaName)}`;
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

/** Creates the "Schemas" group inside a database node, via `SHOW TERSE SCHEMAS`. */
export function createSchemasGroupNode(client: SnowflakeClient, host: ISnowflakePreviewHost, database: string): positron.DataConnectionNode {
	return {
		name: 'Schemas',
		kind: positron.DataConnectionNodeKind.GroupSchemas,
		async getChildren() {
			// SHOW runs without a warehouse; SHOW returns a lowercase `name` column. Every schema is
			// listed, including INFORMATION_SCHEMA -- it is a browsable schema, not noise to hide.
			const result = await client.query(`SHOW TERSE SCHEMAS IN DATABASE ${quoteIdentifier(database)}`);
			return result.rows
				.map(row => String(row.name))
				.sort((a, b) => a.localeCompare(b))
				.map(name => createSchemaNode(client, host, database, name));
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

/** Creates the "Tables" group inside a schema. Lists base tables via `SHOW TERSE TABLES`. */
function createTablesGroupNode(client: SnowflakeClient, host: ISnowflakePreviewHost, database: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: 'Tables',
		kind: positron.DataConnectionNodeKind.GroupTables,
		async getChildren() {
			// SHOW TABLES lists only base tables (views come from SHOW VIEWS) and needs no warehouse.
			const result = await client.query(`SHOW TERSE TABLES IN SCHEMA ${schemaRef(database, schemaName)}`);
			return result.rows
				.map(row => String(row.name))
				.sort((a, b) => a.localeCompare(b))
				.map(name => createRelationNode(client, host, database, schemaName, name, 'table'));
		},
	};
}

/** Creates the "Views" group inside a schema. Lists views via `SHOW TERSE VIEWS`. */
function createViewsGroupNode(client: SnowflakeClient, host: ISnowflakePreviewHost, database: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: 'Views',
		kind: positron.DataConnectionNodeKind.GroupViews,
		async getChildren() {
			const result = await client.query(`SHOW TERSE VIEWS IN SCHEMA ${schemaRef(database, schemaName)}`);
			return result.rows
				.map(row => String(row.name))
				.sort((a, b) => a.localeCompare(b))
				.map(name => createRelationNode(client, host, database, schemaName, name, 'view'));
		},
	};
}

/**
 * Creates the "Stages" group inside a schema. Lists named stages via `SHOW STAGES`. Stages hold files
 * rather than tabular rows, so stage nodes are leaves: no Data Explorer preview and no children
 * (listing a stage's files is deliberately left for a follow-up). Takes no preview host for that
 * reason.
 */
function createStagesGroupNode(client: SnowflakeClient, database: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: 'Stages',
		kind: positron.DataConnectionNodeKind.GroupStages,
		async getChildren() {
			const result = await client.query(`SHOW STAGES IN SCHEMA ${schemaRef(database, schemaName)}`);
			return result.rows
				.map(row => String(row.name))
				.sort((a, b) => a.localeCompare(b))
				.map(name => ({
					name,
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
 * Creates the "Columns" group inside a table or view. Columns come from DESCRIBE TABLE/VIEW.
 * Primary-key detection is intentionally skipped: Snowflake does not enforce primary keys and does not
 * expose them for browsing.
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
			// DESCRIBE needs no warehouse and returns columns in ordinal order with a ready-formatted
			// `type` string (e.g. NUMBER(38,0), TIMESTAMP_NTZ(9)), so no type assembly is needed. Use the
			// keyword matching the relation kind.
			const relationRef = `${schemaRef(database, schemaName)}.${quoteIdentifier(relationName)}`;
			const command = kind === 'view' ? 'DESCRIBE VIEW' : 'DESCRIBE TABLE';
			const result = await client.query(`${command} ${relationRef}`);
			return result.rows.map(row => ({
				name: String(row.name),
				kind: positron.DataConnectionNodeKind.Field,
				dataType: String(row.type),
				// Snowflake does not enforce or expose primary keys for browsing.
				isPrimaryKey: false,
				preview() {
					return host.previewColumn(client, database, schemaName, relationName, kind, String(row.name));
				},
			}));
		},
	};
}
