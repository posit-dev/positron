/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { IDuckDBQueryClient } from './duckdbWorkerClient.js';

/**
 * The capability a table/view/column node needs to open itself in the Data Explorer. Implemented by
 * DuckDBConnection, which owns the worker client and the dataset registration.
 */
export interface IDuckDBPreviewHost {
	/** Opens the given table or view in the Data Explorer. */
	previewObject(schemaName: string, tableName: string, kind: 'table' | 'view'): Promise<void>;
	/** Opens a single column of the given table or view in the Data Explorer. */
	previewColumn(schemaName: string, tableName: string, kind: 'table' | 'view', columnName: string): Promise<void>;
}

/**
 * Creates the root "Schemas" group node. Lists every non-system schema in the current database
 * (catalog) as a child schema node.
 */
export function createSchemasGroupNode(client: IDuckDBQueryClient, host: IDuckDBPreviewHost): positron.DataConnectionNode {
	return {
		name: 'Schemas',
		kind: positron.DataConnectionNodeKind.GroupSchemas,
		async getChildren() {
			const rows = await client.runQuery(
				`SELECT schema_name FROM information_schema.schemata ` +
				`WHERE catalog_name = current_database() ` +
				`AND schema_name NOT IN ('information_schema', 'pg_catalog') ` +
				`ORDER BY schema_name`
			);
			return rows.map(row => createSchemaNode(client, host, String(row.schema_name)));
		},
	};
}

/**
 * Creates a schema node that expands to two category groups: Tables and Views. Exported so unit
 * tests can construct a schema node directly without walking through the root Schemas group.
 */
export function createSchemaNode(
	client: IDuckDBQueryClient,
	host: IDuckDBPreviewHost,
	schemaName: string
): positron.DataConnectionNode {
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
function createTablesGroupNode(
	client: IDuckDBQueryClient,
	host: IDuckDBPreviewHost,
	schemaName: string
): positron.DataConnectionNode {
	return {
		name: 'Tables',
		kind: positron.DataConnectionNodeKind.GroupTables,
		async getChildren() {
			const rows = await client.runQuery(
				`SELECT table_name FROM information_schema.tables ` +
				`WHERE table_catalog = current_database() AND table_schema = $schema ` +
				`AND table_type = 'BASE TABLE' ORDER BY table_name`,
				{ schema: schemaName }
			);
			return rows.map(row => createTableNode(client, host, schemaName, String(row.table_name)));
		},
	};
}

/**
 * Creates the "Views" group inside a schema. Lists views in the schema.
 */
function createViewsGroupNode(
	client: IDuckDBQueryClient,
	host: IDuckDBPreviewHost,
	schemaName: string
): positron.DataConnectionNode {
	return {
		name: 'Views',
		kind: positron.DataConnectionNodeKind.GroupViews,
		async getChildren() {
			const rows = await client.runQuery(
				`SELECT table_name FROM information_schema.tables ` +
				`WHERE table_catalog = current_database() AND table_schema = $schema ` +
				`AND table_type = 'VIEW' ORDER BY table_name`,
				{ schema: schemaName }
			);
			return rows.map(row => createViewNode(client, host, schemaName, String(row.table_name)));
		},
	};
}

/**
 * Creates a table node that expands to show its columns as leaf field nodes.
 */
function createTableNode(
	client: IDuckDBQueryClient,
	host: IDuckDBPreviewHost,
	schemaName: string,
	tableName: string
): positron.DataConnectionNode {
	return {
		name: tableName,
		kind: positron.DataConnectionNodeKind.Table,
		getChildren() {
			return getFieldNodes(client, host, schemaName, tableName, 'table');
		},
		preview() {
			return host.previewObject(schemaName, tableName, 'table');
		},
	};
}

/**
 * Creates a view node that expands to show its columns as leaf field nodes.
 */
function createViewNode(
	client: IDuckDBQueryClient,
	host: IDuckDBPreviewHost,
	schemaName: string,
	viewName: string
): positron.DataConnectionNode {
	return {
		name: viewName,
		kind: positron.DataConnectionNodeKind.View,
		getChildren() {
			return getFieldNodes(client, host, schemaName, viewName, 'view');
		},
		preview() {
			return host.previewObject(schemaName, viewName, 'view');
		},
	};
}

/**
 * Queries information_schema.columns to get column metadata for a table or view.
 * Returns leaf field nodes with dataType set; each can be previewed as a single-column Data Explorer.
 */
async function getFieldNodes(
	client: IDuckDBQueryClient,
	host: IDuckDBPreviewHost,
	schemaName: string,
	relationName: string,
	kind: 'table' | 'view'
): Promise<positron.DataConnectionNode[]> {
	const rows = await client.runQuery(
		`SELECT column_name, data_type FROM information_schema.columns ` +
		`WHERE table_catalog = current_database() AND table_schema = $schema ` +
		`AND table_name = $relation ORDER BY ordinal_position`,
		{ schema: schemaName, relation: relationName }
	);
	return rows.map(row => {
		const columnName = String(row.column_name);
		return {
			name: columnName,
			kind: positron.DataConnectionNodeKind.Field,
			dataType: String(row.data_type),
			preview() {
				return host.previewColumn(schemaName, relationName, kind, columnName);
			},
		};
	});
}
