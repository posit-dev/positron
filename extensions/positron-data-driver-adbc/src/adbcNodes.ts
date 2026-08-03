/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The schema tree for an ADBC connection. Unlike the vendor-specific drivers, which
// query information_schema or a proprietary catalog, every level here comes from ADBC's
// own `getObjects` metadata call at increasing depths, so one implementation serves any
// driver the user points at.

import * as positron from 'positron';
import { AdbcTableRef, IAdbcMetadataClient } from './adbcWorkerClient.js';
import { WorkerObjectDepth, WorkerTableInfo } from './adbcWorkerProtocol.js';

/**
 * The capability a table/view/column node needs to open itself in the Data Explorer.
 * Implemented by AdbcConnection, which owns the dataset registration.
 */
export interface IAdbcPreviewHost {
	/** Opens the given table or view in the Data Explorer. */
	previewObject(ref: AdbcTableRef): Promise<void>;
	/** Opens a single column of the given table or view in the Data Explorer. */
	previewColumn(ref: AdbcTableRef, columnName: string): Promise<void>;
}

/**
 * Table types ADBC drivers report for a regular table and for a view. Drivers are
 * inconsistent here -- SQLite says 'table'/'view', others 'TABLE'/'BASE TABLE'/'VIEW' --
 * so matching is case-insensitive and anything unrecognized is grouped with tables.
 */
const VIEW_TABLE_TYPES = new Set(['view', 'materialized view', 'system view', 'local temporary view']);

/** Whether a driver-reported table type denotes a view rather than a table. */
export function isViewType(tableType: string): boolean {
	return VIEW_TABLE_TYPES.has(tableType.trim().toLowerCase());
}

/**
 * Builds the top-level nodes for a connection.
 *
 * The catalog and schema levels are elided when the driver reports only one and it is
 * unnamed: SQLite, for instance, reports a single catalog 'main' with a single
 * empty-named schema, and showing an empty node for it would be noise. What remains is
 * the shallowest tree that still describes the database.
 */
export async function createRootNodes(client: IAdbcMetadataClient, host: IAdbcPreviewHost): Promise<positron.DataConnectionNode[]> {
	const catalogs = await client.getObjects({ depth: WorkerObjectDepth.Catalogs });

	// A single unnamed catalog carries no information; descend past it.
	if (catalogs.length === 1 && catalogs[0].name === '') {
		return createSchemaLevelNodes(client, host, undefined);
	}
	if (catalogs.length === 0) {
		return createSchemaLevelNodes(client, host, undefined);
	}
	return [createCatalogsGroupNode(client, host, catalogs.map(catalog => catalog.name))];
}

/**
 * Creates the root "Databases" group node listing the catalogs on the server. ADBC calls
 * this level a catalog; the Data Connections tree calls it a database, and the group
 * uses the same node kind as the other drivers so it renders consistently.
 */
export function createCatalogsGroupNode(
	client: IAdbcMetadataClient,
	host: IAdbcPreviewHost,
	catalogNames: string[]
): positron.DataConnectionNode {
	return {
		name: 'Databases',
		kind: positron.DataConnectionNodeKind.GroupDatabases,
		async getChildren() {
			return catalogNames.map(catalog => createCatalogNode(client, host, catalog));
		},
	};
}

/** Creates a catalog node that expands to the schemas it contains. */
export function createCatalogNode(
	client: IAdbcMetadataClient,
	host: IAdbcPreviewHost,
	catalog: string
): positron.DataConnectionNode {
	return {
		name: catalog,
		kind: positron.DataConnectionNodeKind.Database,
		async getChildren() {
			return createSchemaLevelNodes(client, host, catalog);
		},
	};
}

/**
 * Builds the nodes directly beneath a catalog: either a "Schemas" group, or -- when the
 * driver reports a single unnamed schema -- the table and view groups themselves, so the
 * tree does not show an empty schema node.
 */
async function createSchemaLevelNodes(
	client: IAdbcMetadataClient,
	host: IAdbcPreviewHost,
	catalog: string | undefined
): Promise<positron.DataConnectionNode[]> {
	const catalogs = await client.getObjects({ depth: WorkerObjectDepth.Schemas, catalog });
	const schemas = catalogs.flatMap(entry => entry.schemas ?? []);

	if (schemas.length === 1 && schemas[0].name === '') {
		return createTableGroupNodes(client, host, catalog, undefined);
	}
	if (schemas.length === 0) {
		return createTableGroupNodes(client, host, catalog, undefined);
	}
	return [createSchemasGroupNode(client, host, catalog, schemas.map(schema => schema.name))];
}

/** Creates the "Schemas" group node listing the schemas in a catalog. */
export function createSchemasGroupNode(
	client: IAdbcMetadataClient,
	host: IAdbcPreviewHost,
	catalog: string | undefined,
	schemaNames: string[]
): positron.DataConnectionNode {
	return {
		name: 'Schemas',
		kind: positron.DataConnectionNodeKind.GroupSchemas,
		async getChildren() {
			return schemaNames.map(schema => createSchemaNode(client, host, catalog, schema));
		},
	};
}

/** Creates a schema node that expands to the Tables and Views groups. */
export function createSchemaNode(
	client: IAdbcMetadataClient,
	host: IAdbcPreviewHost,
	catalog: string | undefined,
	dbSchema: string
): positron.DataConnectionNode {
	return {
		name: dbSchema,
		kind: positron.DataConnectionNodeKind.Schema,
		async getChildren() {
			return createTableGroupNodes(client, host, catalog, dbSchema);
		},
	};
}

/** The Tables and Views groups shown beneath a schema (or directly beneath a catalog). */
function createTableGroupNodes(
	client: IAdbcMetadataClient,
	host: IAdbcPreviewHost,
	catalog: string | undefined,
	dbSchema: string | undefined
): positron.DataConnectionNode[] {
	return [
		createTablesGroupNode(client, host, catalog, dbSchema, 'table'),
		createTablesGroupNode(client, host, catalog, dbSchema, 'view'),
	];
}

/**
 * Creates the "Tables" or "Views" group. Both are the same metadata request; the results
 * are partitioned by the driver-reported table type rather than filtered server-side,
 * because the `tableType` filter values are not standardized across drivers.
 */
export function createTablesGroupNode(
	client: IAdbcMetadataClient,
	host: IAdbcPreviewHost,
	catalog: string | undefined,
	dbSchema: string | undefined,
	kind: 'table' | 'view'
): positron.DataConnectionNode {
	return {
		name: kind === 'table' ? 'Tables' : 'Views',
		kind: kind === 'table'
			? positron.DataConnectionNodeKind.GroupTables
			: positron.DataConnectionNodeKind.GroupViews,
		async getChildren() {
			const tables = await listTables(client, catalog, dbSchema);
			return tables
				.filter(table => (kind === 'view') === isViewType(table.tableType))
				.map(table => createTableNode(client, host, catalog, dbSchema, table.name, kind));
		},
	};
}

/** Lists the tables in a schema at table depth (no columns yet). */
async function listTables(
	client: IAdbcMetadataClient,
	catalog: string | undefined,
	dbSchema: string | undefined
): Promise<WorkerTableInfo[]> {
	const catalogs = await client.getObjects({ depth: WorkerObjectDepth.Tables, catalog, dbSchema });
	return catalogs
		.flatMap(entry => entry.schemas ?? [])
		.flatMap(schema => schema.tables ?? []);
}

/**
 * Creates a table or view node that expands to its "Columns" group and can be previewed
 * in the Data Explorer. ADBC exposes no index metadata, so -- unlike the PostgreSQL and
 * SQLite drivers -- there is no Indexes group.
 */
export function createTableNode(
	client: IAdbcMetadataClient,
	host: IAdbcPreviewHost,
	catalog: string | undefined,
	dbSchema: string | undefined,
	tableName: string,
	kind: 'table' | 'view'
): positron.DataConnectionNode {
	const ref: AdbcTableRef = { catalog, dbSchema, tableName };
	return {
		name: tableName,
		kind: kind === 'table'
			? positron.DataConnectionNodeKind.Table
			: positron.DataConnectionNodeKind.View,
		async getChildren() {
			return [createColumnsGroupNode(client, host, ref, kind)];
		},
		preview() {
			return host.previewObject(ref);
		},
	};
}

/**
 * Creates the "Columns" group inside a table or view. Each column can be previewed as a
 * single-column Data Explorer. Primary-key membership comes from the driver's constraint
 * metadata when it reports any; views have no primary key.
 */
export function createColumnsGroupNode(
	client: IAdbcMetadataClient,
	host: IAdbcPreviewHost,
	ref: AdbcTableRef,
	kind: 'table' | 'view'
): positron.DataConnectionNode {
	return {
		name: 'Columns',
		kind: positron.DataConnectionNodeKind.GroupColumns,
		async getChildren() {
			const catalogs = await client.getObjects({
				depth: WorkerObjectDepth.All,
				catalog: ref.catalog,
				dbSchema: ref.dbSchema,
				tableName: ref.tableName,
			});
			const table = catalogs
				.flatMap(entry => entry.schemas ?? [])
				.flatMap(schema => schema.tables ?? [])
				.find(candidate => candidate.name === ref.tableName);
			if (!table) {
				return [];
			}
			const primaryKeys = new Set(kind === 'table' ? table.primaryKeyColumns ?? [] : []);
			return (table.columns ?? []).map(column => ({
				name: column.name,
				kind: positron.DataConnectionNodeKind.Field,
				dataType: column.typeName,
				isPrimaryKey: primaryKeys.has(column.name),
				preview() {
					return host.previewColumn(ref, column.name);
				},
			}));
		},
	};
}
