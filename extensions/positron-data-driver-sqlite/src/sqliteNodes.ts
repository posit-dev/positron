/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { ISqliteQueryClient } from './sqliteWorkerClient.js';

/**
 * Builds the top-level children: three category group nodes (Tables, Views, Indexes).
 * Each group defers its schema query until it is itself expanded.
 */
export function createRootNodes(client: ISqliteQueryClient): positron.DataConnectionNode[] {
	return [
		createGroupNode('Tables', positron.DataConnectionNodeKind.GroupTables,
			async () => (await listObjects(client, 'table')).map(name => createTableNode(client, name))),
		createGroupNode('Views', positron.DataConnectionNodeKind.GroupViews,
			async () => (await listObjects(client, 'view')).map(name => createViewNode(client, name))),
		createGroupNode('Indexes', positron.DataConnectionNodeKind.GroupIndexes,
			async () => (await listObjects(client, 'index')).map(name => createIndexNode(client, name))),
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
 * Lists object names of the given sqlite_master type ('table' | 'view' | 'index'),
 * excluding internal sqlite_-prefixed objects (which also covers auto-generated
 * sqlite_autoindex_* indexes).
 */
async function listObjects(client: ISqliteQueryClient, type: 'table' | 'view' | 'index'): Promise<string[]> {
	const rows = await client.runQuery(
		`SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`,
		[type]
	);
	return rows.map(row => String(row.name));
}

/**
 * Creates a table node that can expand to show columns.
 */
export function createTableNode(
	client: ISqliteQueryClient,
	tableName: string
): positron.DataConnectionNode {
	return {
		name: tableName,
		kind: positron.DataConnectionNodeKind.Table,
		getChildren() {
			return getFieldNodes(client, tableName);
		},
		preview() {
			// TODO: Wire up to Data Explorer when the preview UI is available.
			return Promise.resolve();
		},
	};
}

/**
 * Creates a view node that can expand to show columns.
 */
export function createViewNode(
	client: ISqliteQueryClient,
	viewName: string
): positron.DataConnectionNode {
	return {
		name: viewName,
		kind: positron.DataConnectionNodeKind.View,
		getChildren() {
			return getFieldNodes(client, viewName);
		},
		preview() {
			// TODO: Wire up to Data Explorer when the preview UI is available.
			return Promise.resolve();
		},
	};
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
 * Creates a trigger node (leaf). Triggers don't expose meaningful child structure for
 * schema browsing -- the underlying SQL definition isn't a tree.
 */
export function createTriggerNode(triggerName: string): positron.DataConnectionNode {
	return {
		name: triggerName,
		kind: positron.DataConnectionNodeKind.Trigger,
	};
}

/**
 * Queries PRAGMA table_info to get column metadata for a table or view.
 * Returns leaf field nodes with dataType set.
 */
async function getFieldNodes(
	client: ISqliteQueryClient,
	tableName: string
): Promise<positron.DataConnectionNode[]> {
	// PRAGMA statements don't support parameter binding, so we escape
	// the table name by double-quoting with embedded quotes escaped.
	const safeTableName = tableName.replace(/"/g, '""');
	const rows = await client.runQuery(`PRAGMA table_info("${safeTableName}")`);

	return rows.map(row => ({
		name: String(row.name),
		kind: positron.DataConnectionNodeKind.Field,
		// SQLite allows empty type affinity; default to BLOB.
		dataType: row.type ? String(row.type) : 'BLOB',
	}));
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
