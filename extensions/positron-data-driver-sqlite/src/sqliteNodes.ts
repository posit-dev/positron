/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import Database from 'better-sqlite3';
import * as positron from 'positron';

/**
 * Creates a category group node. Group nodes are containers that defer fetching their
 * contents until the user expands them -- the schema query for the group's category runs
 * inside getChildren().
 */
export function createGroupNode(
	name: string,
	getChildren: () => positron.DataConnectionNode[]
): positron.DataConnectionNode {
	return {
		name,
		kind: positron.DataConnectionNodeKind.Group,
		getChildren() {
			return Promise.resolve(getChildren());
		},
	};
}

/**
 * Creates a table node that can expand to show columns.
 */
export function createTableNode(
	db: Database.Database,
	tableName: string
): positron.DataConnectionNode {
	return {
		name: tableName,
		kind: positron.DataConnectionNodeKind.Table,
		getChildren() {
			return Promise.resolve(getFieldNodes(db, tableName));
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
	db: Database.Database,
	viewName: string
): positron.DataConnectionNode {
	return {
		name: viewName,
		kind: positron.DataConnectionNodeKind.View,
		getChildren() {
			return Promise.resolve(getFieldNodes(db, viewName));
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
	db: Database.Database,
	indexName: string
): positron.DataConnectionNode {
	return {
		name: indexName,
		kind: positron.DataConnectionNodeKind.Index,
		getChildren() {
			return Promise.resolve(getIndexColumnNodes(db, indexName));
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
function getFieldNodes(
	db: Database.Database,
	tableName: string
): positron.DataConnectionNode[] {
	// PRAGMA statements don't support parameter binding, so we escape
	// the table name by double-quoting with embedded quotes escaped.
	const safeTableName = tableName.replace(/"/g, '""');
	const rows = db.prepare(
		`PRAGMA table_info("${safeTableName}")`
	).all() as Array<{
		cid: number;
		name: string;
		type: string;
		notnull: number;
		dflt_value: string | null;
		pk: number;
	}>;

	return rows.map(row => ({
		name: row.name,
		kind: positron.DataConnectionNodeKind.Field,
		// SQLite allows empty type affinity; default to BLOB.
		dataType: row.type || 'BLOB',
	}));
}

/**
 * Queries PRAGMA index_info to get the columns an index covers. Returned column names match
 * the underlying table's column names; type affinity isn't available here, so dataType is
 * omitted.
 */
function getIndexColumnNodes(
	db: Database.Database,
	indexName: string
): positron.DataConnectionNode[] {
	const safeIndexName = indexName.replace(/"/g, '""');
	const rows = db.prepare(
		`PRAGMA index_info("${safeIndexName}")`
	).all() as Array<{ seqno: number; cid: number; name: string }>;

	return rows.map(row => ({
		name: row.name,
		kind: positron.DataConnectionNodeKind.Field,
	}));
}
