/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { ISqliteQueryClient } from './sqliteWorkerClient.js';

/**
 * The capability a table/view node needs to open itself in the Data Explorer. Implemented by
 * SQLiteConnection, which owns the worker client and the dataset registration.
 */
export interface ISqlitePreviewHost {
	/** Opens the given table or view in the Data Explorer. */
	previewObject(name: string, kind: 'table' | 'view'): Promise<void>;
	/** Opens a single column of the given table or view in the Data Explorer. */
	previewColumn(tableName: string, kind: 'table' | 'view', columnName: string): Promise<void>;
}

/**
 * Builds the top-level children: two category group nodes (Tables, Views). Indexes are not a
 * top-level concept in SQLite -- each index belongs to a single table -- so they appear nested
 * under their table rather than here. Each group defers its schema query until it is expanded.
 */
export function createRootNodes(client: ISqliteQueryClient, host: ISqlitePreviewHost): positron.DataConnectionNode[] {
	return [
		createGroupNode('Tables', positron.DataConnectionNodeKind.GroupTables,
			async () => (await listObjects(client, 'table')).map(name => createTableNode(client, host, name))),
		createGroupNode('Views', positron.DataConnectionNodeKind.GroupViews,
			async () => (await listObjects(client, 'view')).map(name => createViewNode(client, host, name))),
	];
}

/**
 * Creates a category group node. Group nodes are containers that defer fetching their
 * contents until the user expands them -- the schema query for the group's category runs
 * inside getChildren().
 */
export function createGroupNode(
	name: string,
	kind: positron.DataConnectionNodeKind,
	getChildren: () => Promise<positron.DataConnectionNode[]>
): positron.DataConnectionNode {
	return {
		name,
		kind,
		getChildren,
	};
}

/**
 * Lists object names of the given sqlite_master type ('table' | 'view'), excluding internal
 * sqlite_-prefixed objects.
 */
async function listObjects(client: ISqliteQueryClient, type: 'table' | 'view'): Promise<string[]> {
	const rows = await client.runQuery(
		`SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`,
		[type]
	);
	return rows.map(row => String(row.name));
}

/**
 * Creates a table node that expands to two category groups: Columns and Indexes.
 */
export function createTableNode(
	client: ISqliteQueryClient,
	host: ISqlitePreviewHost,
	tableName: string
): positron.DataConnectionNode {
	return {
		name: tableName,
		kind: positron.DataConnectionNodeKind.Table,
		async getChildren() {
			return [
				createColumnsGroupNode(client, host, tableName, 'table'),
				createIndexesGroupNode(client, tableName),
			];
		},
		preview() {
			return host.previewObject(tableName, 'table');
		},
	};
}

/**
 * Creates a view node that expands to a single "Columns" group. Views don't have indexes in the
 * schema-browsing sense, so there's only one category under each view.
 */
export function createViewNode(
	client: ISqliteQueryClient,
	host: ISqlitePreviewHost,
	viewName: string
): positron.DataConnectionNode {
	return {
		name: viewName,
		kind: positron.DataConnectionNodeKind.View,
		async getChildren() {
			return [createColumnsGroupNode(client, host, viewName, 'view')];
		},
		preview() {
			return host.previewObject(viewName, 'view');
		},
	};
}

/**
 * Creates the "Columns" group inside a table or view. Defers the column query until expanded.
 */
function createColumnsGroupNode(
	client: ISqliteQueryClient,
	host: ISqlitePreviewHost,
	relationName: string,
	kind: 'table' | 'view'
): positron.DataConnectionNode {
	return createGroupNode('Columns', positron.DataConnectionNodeKind.GroupColumns,
		() => getFieldNodes(client, host, relationName, kind));
}

/**
 * Creates the "Indexes" group inside a table. Lists the table's indexes, each of which can expand
 * to show the columns it covers. Auto-created indexes (sqlite_autoindex_*) backing PRIMARY KEY /
 * UNIQUE constraints are excluded.
 */
function createIndexesGroupNode(
	client: ISqliteQueryClient,
	tableName: string
): positron.DataConnectionNode {
	return createGroupNode('Indexes', positron.DataConnectionNodeKind.GroupIndexes,
		async () => (await listTableIndexes(client, tableName)).map(name => createIndexNode(client, name)));
}

/**
 * Lists the names of the indexes defined on a given table, excluding internal sqlite_-prefixed
 * indexes (which covers the auto-generated sqlite_autoindex_* indexes).
 */
async function listTableIndexes(client: ISqliteQueryClient, tableName: string): Promise<string[]> {
	const rows = await client.runQuery(
		`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`,
		[tableName]
	);
	return rows.map(row => String(row.name));
}

/**
 * Creates an index node that can expand to show the columns the index covers.
 */
export function createIndexNode(
	client: ISqliteQueryClient,
	indexName: string
): positron.DataConnectionNode {
	return {
		name: indexName,
		kind: positron.DataConnectionNodeKind.Index,
		getChildren() {
			return getIndexColumnNodes(client, indexName);
		},
	};
}

/**
 * Queries PRAGMA table_info to get column metadata for a table or view.
 * Returns leaf field nodes with dataType set; each can be previewed as a single-column Data Explorer.
 */
async function getFieldNodes(
	client: ISqliteQueryClient,
	host: ISqlitePreviewHost,
	tableName: string,
	kind: 'table' | 'view'
): Promise<positron.DataConnectionNode[]> {
	// PRAGMA statements don't support parameter binding, so we escape
	// the table name by double-quoting with embedded quotes escaped.
	const safeTableName = tableName.replace(/"/g, '""');
	const rows = await client.runQuery(`PRAGMA table_info("${safeTableName}")`);

	return rows.map(row => {
		const columnName = String(row.name);
		return {
			name: columnName,
			kind: positron.DataConnectionNodeKind.Field,
			// SQLite allows empty type affinity; default to BLOB.
			dataType: row.type ? String(row.type) : 'BLOB',
			// PRAGMA table_info reports `pk` as the 1-based position within the primary key, or 0 if
			// the column isn't part of it. Views report 0 for every column.
			isPrimaryKey: kind === 'table' && Number(row.pk) > 0,
			preview() {
				return host.previewColumn(tableName, kind, columnName);
			},
		};
	});
}

/**
 * Queries PRAGMA index_info to get the columns an index covers. Returned column names match
 * the underlying table's column names; type affinity isn't available here, so dataType is
 * omitted.
 */
async function getIndexColumnNodes(
	client: ISqliteQueryClient,
	indexName: string
): Promise<positron.DataConnectionNode[]> {
	const safeIndexName = indexName.replace(/"/g, '""');
	const rows = await client.runQuery(`PRAGMA index_info("${safeIndexName}")`);

	return rows.map(row => ({
		name: String(row.name),
		kind: positron.DataConnectionNodeKind.Field,
	}));
}
