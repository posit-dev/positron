/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Schema-tree node builders for a Databricks connection. A connection can see every catalog its
// credentials are granted on, so the tree is rooted at a "Catalogs" group: Catalogs > catalog >
// Schemas > schema > Tables/Views/Volumes, where a relation expands to its Columns and a volume to the
// files and directories it holds.
//
// Browsing deliberately avoids SELECTs against information_schema, because information_schema exists
// only under Unity Catalog -- the legacy `hive_metastore` catalog has none, and it is still browsable.
// Catalogs and schemas come from SHOW commands and columns from DESCRIBE, each scoped by
// fully-qualified name so it works whatever the session currently has selected. Relations are the one
// exception: they come from the metadata API, because the SHOW form of that query cannot reach across
// catalogs (see `relationNames`).
//
// Databricks primary keys are informational only (declared but never enforced, and not reported by
// DESCRIBE), so no primary-key detection is attempted and field nodes are never marked as primary
// keys.

import * as positron from 'positron';
import { DatabricksClient } from './databricksClient.js';
import {
	describeTableSql,
	metadataString,
	parseDescribeRows,
	quoteIdentifier,
	quoteLiteral,
	tableRef,
} from './databricksSql.js';

/**
 * The capability a table/view/column node needs to open itself in the Data Explorer. Implemented by
 * DatabricksConnection, which owns the dataset registration. `client` is the client the node was
 * built against; `catalog` is the catalog the object lives in, so previews use a three-part
 * reference.
 */
export interface IDatabricksPreviewHost {
	/** Opens the given table or view in the Data Explorer, returning its dataset id. */
	previewObject(client: DatabricksClient, catalog: string, schemaName: string, tableName: string, kind: 'table' | 'view'): Promise<string>;
	/** Opens a single column of the given table or view in the Data Explorer, returning its dataset id. */
	previewColumn(client: DatabricksClient, catalog: string, schemaName: string, tableName: string, kind: 'table' | 'view', columnName: string): Promise<string>;
}

/** Sorts names in locale order, matching how they are displayed. */
function byName(a: string, b: string): number {
	return a.localeCompare(b);
}

/**
 * Creates the root "Catalogs" group node, listing every catalog the connection can see (including
 * the legacy `hive_metastore`, which is a browsable catalog rather than noise to hide).
 */
export function createCatalogsGroupNode(client: DatabricksClient, host: IDatabricksPreviewHost): positron.DataConnectionNode {
	return {
		name: 'Catalogs',
		kind: positron.DataConnectionNodeKind.GroupCatalogs,
		async getChildren() {
			const result = await client.query('SHOW CATALOGS');
			return result.rows
				.map(row => metadataString(row, ['catalog', 'catalogName']))
				.sort(byName)
				.map(name => createCatalogNode(client, host, name));
		},
	};
}

/**
 * Creates a catalog node that expands to a single "Schemas" group. Exported so unit tests can
 * construct a catalog node directly against a mocked client.
 */
export function createCatalogNode(client: DatabricksClient, host: IDatabricksPreviewHost, catalog: string): positron.DataConnectionNode {
	return {
		name: catalog,
		kind: positron.DataConnectionNodeKind.Catalog,
		async getChildren() {
			return [createSchemasGroupNode(client, host, catalog)];
		},
	};
}

/** Creates the "Schemas" group inside a catalog node, via `SHOW SCHEMAS`. */
export function createSchemasGroupNode(client: DatabricksClient, host: IDatabricksPreviewHost, catalog: string): positron.DataConnectionNode {
	return {
		name: 'Schemas',
		kind: positron.DataConnectionNodeKind.GroupSchemas,
		async getChildren() {
			const result = await client.query(`SHOW SCHEMAS IN ${quoteIdentifier(catalog)}`);
			return result.rows
				.map(row => metadataString(row, ['databaseName', 'namespace', 'schemaName']))
				.sort(byName)
				.map(name => createSchemaNode(client, host, catalog, name));
		},
	};
}

/**
 * Creates a schema node that expands to Tables and Views groups. Exported so unit tests can
 * construct a schema node directly against a mocked client.
 */
export function createSchemaNode(client: DatabricksClient, host: IDatabricksPreviewHost, catalog: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: schemaName,
		kind: positron.DataConnectionNodeKind.Schema,
		async getChildren() {
			return [
				createTablesGroupNode(client, host, catalog, schemaName),
				createViewsGroupNode(client, host, catalog, schemaName),
				createVolumesGroupNode(client, catalog, schemaName),
			];
		},
	};
}

/**
 * Lists the names of a schema's relations of the requested kind, through the metadata API.
 *
 * The metadata API is used rather than `SHOW TABLES` / `SHOW VIEWS` because those name the schema as a
 * SQL identifier, and Databricks rejects a two-part `catalog.schema` reference in them unless that
 * catalog is the session's current one; the metadata API takes the catalog as a parameter (see
 * `DatabricksClient.listTables`). It also reports each relation's TABLE_TYPE, so tables and views come
 * from one call and need no subtraction.
 */
async function relationNames(client: DatabricksClient, catalog: string, schemaName: string, kind: 'table' | 'view'): Promise<string[]> {
	const result = await client.listTables(catalog, schemaName);
	return result.rows
		.filter(row => {
			// `schemaName` went out as a LIKE pattern, where '_' matches any character -- and underscores
			// are common in schema names -- so a match on another schema is filtered out here. A row that
			// reports no schema at all is kept: it cannot be an over-match, and dropping it would empty
			// the group.
			const rowSchema = metadataString(row, ['TABLE_SCHEM', 'TABLE_SCHEMA', 'tableSchema']);
			return rowSchema === '' || rowSchema === schemaName;
		})
		.filter(row => {
			// Anything the server calls a view (including a materialized view) belongs under Views;
			// everything else -- MANAGED, EXTERNAL, STREAMING_TABLE -- is a table. If a server reports no
			// type at all, its relations all land under Tables rather than vanishing from both groups.
			const type = metadataString(row, ['TABLE_TYPE', 'tableType']).toUpperCase();
			return kind === 'view' ? type.includes('VIEW') : !type.includes('VIEW');
		})
		.map(row => metadataString(row, ['TABLE_NAME', 'tableName']))
		.sort(byName);
}

/** Creates the "Tables" group inside a schema. */
function createTablesGroupNode(client: DatabricksClient, host: IDatabricksPreviewHost, catalog: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: 'Tables',
		kind: positron.DataConnectionNodeKind.GroupTables,
		async getChildren() {
			const names = await relationNames(client, catalog, schemaName, 'table');
			return names.map(name => createRelationNode(client, host, catalog, schemaName, name, 'table'));
		},
	};
}

/** Creates the "Views" group inside a schema. */
function createViewsGroupNode(client: DatabricksClient, host: IDatabricksPreviewHost, catalog: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: 'Views',
		kind: positron.DataConnectionNodeKind.GroupViews,
		async getChildren() {
			const names = await relationNames(client, catalog, schemaName, 'view');
			return names.map(name => createRelationNode(client, host, catalog, schemaName, name, 'view'));
		},
	};
}

/**
 * Creates the "Volumes" group inside a schema, listing the schema's Unity Catalog volumes.
 *
 * Volumes come from `<catalog>.information_schema.volumes` rather than `SHOW VOLUMES IN
 * catalog.schema`, which hits the same cross-catalog restriction as `SHOW TABLES` (see
 * `relationNames`). A three-part information_schema reference is a table reference, which is allowed
 * across catalogs. That the view exists only under Unity Catalog is not a limitation here: volumes are
 * themselves a Unity Catalog concept, so a catalog without an information_schema (`hive_metastore`) has
 * no volumes to list, and the failed lookup is reported as an empty group rather than an error.
 *
 * No preview host is threaded through: a volume holds files rather than rows, so nothing under it opens
 * in the Data Explorer.
 */
function createVolumesGroupNode(client: DatabricksClient, catalog: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: 'Volumes',
		kind: positron.DataConnectionNodeKind.GroupVolumes,
		async getChildren() {
			const sql = `SELECT volume_name FROM ${quoteIdentifier(catalog)}.information_schema.volumes ` +
				`WHERE volume_schema = '${quoteLiteral(schemaName)}'`;
			let rows: Array<Record<string, unknown>>;
			try {
				rows = (await client.query(sql)).rows;
			} catch {
				// The catalog has no information_schema, so it is not a Unity Catalog catalog and cannot
				// contain volumes. An empty group is the honest answer; an error would suggest the volumes
				// are there but unreachable.
				return [];
			}
			return rows
				.map(row => metadataString(row, ['volume_name']))
				.sort(byName)
				.map(name => createVolumeNode(client, catalog, schemaName, name));
		},
	};
}

/** Creates a volume node, which expands to the files and directories at the volume's root. */
function createVolumeNode(client: DatabricksClient, catalog: string, schemaName: string, volumeName: string): positron.DataConnectionNode {
	// Every volume is mounted at this well-known path, which is how SQL addresses its contents.
	const root = `/Volumes/${catalog}/${schemaName}/${volumeName}`;
	return {
		name: volumeName,
		kind: positron.DataConnectionNodeKind.Volume,
		async getChildren() {
			return listPath(client, root);
		},
	};
}

/** One entry in a volume directory listing. */
interface VolumeEntry {
	name: string;
	isDirectory: boolean;
	size?: number;
}

/**
 * Lists a path inside a volume via the `LIST` command, which reads a volume's contents over the same
 * SQL connection (no separate Files API call, and so no second set of credentials to manage).
 *
 * Child paths are rebuilt from the parent path and each entry's own name rather than taken from the
 * result's `path` column, whose form varies (it may come back scheme-qualified), so the paths this
 * walks stay in the one `/Volumes/...` form `LIST` is known to accept.
 */
async function listPath(client: DatabricksClient, path: string): Promise<positron.DataConnectionNode[]> {
	const result = await client.query(`LIST '${quoteLiteral(path)}'`);
	const entries: VolumeEntry[] = [];
	for (const row of result.rows) {
		const raw = metadataString(row, ['name']);
		// A directory is reported with a trailing slash; keep the flag and drop the slash for display.
		const isDirectory = raw.endsWith('/');
		// Defend against a server that reports the whole path here rather than just the entry name.
		const name = raw.replace(/\/+$/, '').split('/').pop() ?? '';
		if (name.length === 0) {
			continue;
		}
		const rawSize = row.size;
		const size = rawSize === null || rawSize === undefined ? undefined : Number(rawSize);
		entries.push({ name, isDirectory, size });
	}
	// Directories first, then files, each in name order -- the ordering a file browser uses.
	entries.sort((a, b) => a.isDirectory === b.isDirectory ? byName(a.name, b.name) : (a.isDirectory ? -1 : 1));
	return entries.map(entry => entry.isDirectory
		? {
			name: entry.name,
			kind: positron.DataConnectionNodeKind.Directory,
			getChildren: () => listPath(client, `${path}/${entry.name}`),
		}
		: {
			name: entry.name,
			kind: positron.DataConnectionNodeKind.File,
			// The tree renders dataType as a trailing label, which is where a file's size belongs.
			dataType: entry.size === undefined ? undefined : formatFileSize(entry.size),
		});
}

/** Formats a byte count for display next to a file name. */
export function formatFileSize(bytes: number): string {
	if (!isFinite(bytes) || bytes < 0) {
		return '';
	}
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	// Whole bytes need no decimal; every larger unit reads better with one.
	return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}

/** Creates a table or view node that expands to a single "Columns" group. */
function createRelationNode(
	client: DatabricksClient,
	host: IDatabricksPreviewHost,
	catalog: string,
	schemaName: string,
	relationName: string,
	kind: 'table' | 'view'
): positron.DataConnectionNode {
	return {
		name: relationName,
		kind: kind === 'table' ? positron.DataConnectionNodeKind.Table : positron.DataConnectionNodeKind.View,
		async getChildren() {
			return [createColumnsGroupNode(client, host, catalog, schemaName, relationName, kind)];
		},
		preview() {
			return host.previewObject(client, catalog, schemaName, relationName, kind);
		},
	};
}

/**
 * Creates the "Columns" group inside a table or view. Columns come from DESCRIBE TABLE, which
 * returns them in ordinal order with a ready-formatted type string.
 */
function createColumnsGroupNode(
	client: DatabricksClient,
	host: IDatabricksPreviewHost,
	catalog: string,
	schemaName: string,
	relationName: string,
	kind: 'table' | 'view'
): positron.DataConnectionNode {
	return {
		name: 'Columns',
		kind: positron.DataConnectionNodeKind.GroupColumns,
		async getChildren() {
			const result = await client.query(describeTableSql(tableRef(catalog, schemaName, relationName)));
			return parseDescribeRows(result.rows).map(column => ({
				name: column.name,
				kind: positron.DataConnectionNodeKind.Field,
				dataType: column.dataType,
				// Databricks primary keys are informational only and are not reported by DESCRIBE.
				isPrimaryKey: false,
				preview() {
					return host.previewColumn(client, catalog, schemaName, relationName, kind, column.name);
				},
			}));
		},
	};
}
