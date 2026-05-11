/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import Database from 'better-sqlite3';
import * as positron from 'positron';

/**
 * Creates a table node that can expand to show columns.
 * @param db The open database handle.
 * @param tableName The table name.
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
 * @param db The open database handle.
 * @param viewName The view name.
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
 * Queries PRAGMA table_info to get column metadata for a table or view.
 * Returns leaf field nodes with dataType set.
 * @param db The open database handle.
 * @param tableName The table or view name to inspect.
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
