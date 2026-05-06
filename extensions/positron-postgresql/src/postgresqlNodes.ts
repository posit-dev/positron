/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client } from 'pg';
import * as positron from 'positron';

/**
 * Creates a schema node that can expand to show tables and views.
 * @param client The open pg client.
 * @param schemaName The schema name.
 */
export function createSchemaNode(
	client: Client,
	schemaName: string
): positron.DataConnectionNode {
	return {
		name: schemaName,
		kind: positron.DataConnectionNodeKind.Schema,
		getChildren() {
			return getTablesAndViews(client, schemaName);
		},
	};
}

/**
 * Queries tables and views in a schema and returns them as nodes.
 * @param client The open pg client.
 * @param schemaName The schema to inspect.
 */
async function getTablesAndViews(
	client: Client,
	schemaName: string
): Promise<positron.DataConnectionNode[]> {
	const result = await client.query(`SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_type, table_name`, [schemaName]);

	// Tables first, then views.
	const tables = result.rows
		.filter(row => row.table_type === 'BASE TABLE')
		.map(row => createTableNode(client, schemaName, row.table_name));

	const views = result.rows
		.filter(row => row.table_type === 'VIEW')
		.map(row => createViewNode(client, schemaName, row.table_name));

	return [...tables, ...views];
}

/**
 * Creates a table node that can expand to show columns.
 * @param client The open pg client.
 * @param schemaName The schema containing the table.
 * @param tableName The table name.
 */
function createTableNode(
	client: Client,
	schemaName: string,
	tableName: string
): positron.DataConnectionNode {
	return {
		name: tableName,
		kind: positron.DataConnectionNodeKind.Table,
		getChildren() {
			return getFieldNodes(client, schemaName, tableName);
		},
		preview() {
			// TODO: Wire up to Data Explorer when the preview UI is available.
			return Promise.resolve();
		},
	};
}

/**
 * Creates a view node that can expand to show columns.
 * @param client The open pg client.
 * @param schemaName The schema containing the view.
 * @param viewName The view name.
 */
function createViewNode(
	client: Client,
	schemaName: string,
	viewName: string
): positron.DataConnectionNode {
	return {
		name: viewName,
		kind: positron.DataConnectionNodeKind.View,
		getChildren() {
			return getFieldNodes(client, schemaName, viewName);
		},
		preview() {
			// TODO: Wire up to Data Explorer when the preview UI is available.
			return Promise.resolve();
		},
	};
}

/**
 * Queries column metadata for a table or view and returns field nodes.
 * @param client The open pg client.
 * @param schemaName The schema name.
 * @param tableName The table or view name.
 */
async function getFieldNodes(
	client: Client,
	schemaName: string,
	tableName: string
): Promise<positron.DataConnectionNode[]> {
	const result = await client.query(`SELECT column_name, data_type, udt_name, is_nullable, character_maximum_length, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`, [schemaName, tableName]);

	return result.rows.map(row => ({
		name: row.column_name,
		kind: positron.DataConnectionNodeKind.Field,
		dataType: formatDataType(row),
	}));
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
