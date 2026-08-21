/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The schema tree, built from ODBC's catalog functions rather than from SQL.
//
// Every other Positron data driver queries its backend's information schema, which means writing
// dialect-specific SQL. ODBC cannot: the whole point is that the backend is unknown. SQLTables and
// SQLColumns are the driver-agnostic equivalent, and every conforming ODBC driver implements them,
// so the same code here browses SQL Server, MySQL, Snowflake, and Teradata alike.
//
// The one structural consequence is that the table list is fetched in a single SQLTables call and
// grouped in memory, rather than a query per level. ODBC has no portable way to ask "what schemas
// exist" -- the SQL_ALL_SCHEMAS form of SQLTables is optional and unevenly implemented -- so one
// call plus in-memory grouping is the approach that behaves the same everywhere. On a server with
// very many tables that is a large first response; the list is fetched once per connection and
// reused for the whole session.

import * as positron from 'positron';
import { IOdbcQueryClient } from './odbcWorkerClient';
import { OdbcRow } from './odbcWorkerProtocol';

/** A table or view, identified the way ODBC identifies it. */
export interface OdbcTableRef {
	/** The catalog, when the backend uses them (SQL Server databases, Snowflake catalogs). */
	readonly catalog?: string;

	/** The schema, when the backend uses them. */
	readonly schema?: string;

	readonly name: string;

	/** Whether it is a base table or a view, which decides the icon and the node's children. */
	readonly kind: 'table' | 'view';
}

/**
 * The capability a table/view/column node needs to open itself in the Data Explorer. Implemented by
 * OdbcConnection, which owns the dataset registration.
 */
export interface IOdbcPreviewHost {
	/** Opens the given table or view in the Data Explorer, returning its dataset id. */
	previewObject(ref: OdbcTableRef): Promise<string>;

	/** Opens a single column of the given table or view in the Data Explorer, returning its dataset id. */
	previewColumn(ref: OdbcTableRef, columnName: string): Promise<string>;
}

/**
 * Reads the table list via SQLTables. Views are requested alongside tables so both appear under
 * their schema; ODBC reports the distinction in TABLE_TYPE.
 *
 * Some drivers report types beyond TABLE and VIEW (SYSTEM TABLE, GLOBAL TEMPORARY, ALIAS, ...).
 * Asking for the two we render keeps the response to what the tree can show, and keeps system
 * catalogs out of the user's way.
 */
export async function fetchTables(client: IOdbcQueryClient): Promise<OdbcTableRef[]> {
	const rows = await client.tables(null, null, null, 'TABLE,VIEW');
	return rows.map(row => ({
		catalog: optionalString(row['TABLE_CAT']),
		schema: optionalString(row['TABLE_SCHEM']),
		name: String(row['TABLE_NAME'] ?? ''),
		kind: /view/i.test(String(row['TABLE_TYPE'] ?? '')) ? 'view' as const : 'table' as const,
	})).filter(ref => ref.name.length > 0);
}

/** Coerces an ODBC catalog value to a string, treating null and empty as "not applicable". */
function optionalString(value: unknown): string | undefined {
	if (value === null || value === undefined) {
		return undefined;
	}
	const text = String(value);
	return text.length > 0 ? text : undefined;
}

/**
 * Builds the top-level nodes for a connection.
 *
 * The shape adapts to what the backend actually uses, because ODBC backends disagree about how many
 * levels of namespace they have. A catalog level appears only when the tables span more than one
 * catalog, and likewise for schemas; a backend with a single unnamed schema (MySQL, SQLite) drops
 * straight to Tables and Views. Rendering an "Unknown" catalog containing one "Unknown" schema
 * would be noise on exactly the backends that are simplest.
 */
export function createRootNodes(
	tables: readonly OdbcTableRef[],
	client: IOdbcQueryClient,
	host: IOdbcPreviewHost
): positron.DataConnectionNode[] {
	const catalogs = distinct(tables.map(table => table.catalog));

	// More than one catalog: a Catalogs group, each expanding to its schemas.
	if (catalogs.length > 1) {
		return [{
			name: 'Catalogs',
			kind: positron.DataConnectionNodeKind.GroupCatalogs,
			getChildren: async () => catalogs.map(catalog => ({
				name: catalog ?? '(default)',
				kind: positron.DataConnectionNodeKind.Catalog,
				getChildren: async () => createSchemaLevel(
					tables.filter(table => table.catalog === catalog), client, host),
			})),
		}];
	}

	return createSchemaLevel(tables, client, host);
}

/**
 * Builds the schema level for a set of tables that already share a catalog. Collapses to the
 * Tables/Views groups when there is nothing meaningful to distinguish schemas by.
 */
function createSchemaLevel(
	tables: readonly OdbcTableRef[],
	client: IOdbcQueryClient,
	host: IOdbcPreviewHost
): positron.DataConnectionNode[] {
	const schemas = distinct(tables.map(table => table.schema));

	if (schemas.length > 1 || (schemas.length === 1 && schemas[0] !== undefined)) {
		return [{
			name: 'Schemas',
			kind: positron.DataConnectionNodeKind.GroupSchemas,
			getChildren: async () => schemas.map(schema => ({
				name: schema ?? '(default)',
				kind: positron.DataConnectionNodeKind.Schema,
				getChildren: async () => createObjectGroups(
					tables.filter(table => table.schema === schema), client, host),
			})),
		}];
	}

	return createObjectGroups(tables, client, host);
}

/**
 * Builds the Tables and Views groups for a set of tables that already share a namespace. A group
 * with nothing in it is omitted rather than shown empty -- a backend with no views should not
 * display a "Views" node that expands to nothing.
 */
function createObjectGroups(
	tables: readonly OdbcTableRef[],
	client: IOdbcQueryClient,
	host: IOdbcPreviewHost
): positron.DataConnectionNode[] {
	const groups: positron.DataConnectionNode[] = [];

	const baseTables = tables.filter(table => table.kind === 'table');
	if (baseTables.length > 0) {
		groups.push({
			name: 'Tables',
			kind: positron.DataConnectionNodeKind.GroupTables,
			getChildren: async () => baseTables.map(table => createTableNode(table, client, host)),
		});
	}

	const views = tables.filter(table => table.kind === 'view');
	if (views.length > 0) {
		groups.push({
			name: 'Views',
			kind: positron.DataConnectionNodeKind.GroupViews,
			getChildren: async () => views.map(view => createTableNode(view, client, host)),
		});
	}

	return groups;
}

/**
 * Creates a table or view node. Both expand to a single Columns group -- ODBC exposes indexes via
 * SQLStatistics, which node-odbc does not surface, so unlike the PostgreSQL driver there is no
 * Indexes group to offer.
 *
 * Exported so unit tests can build a node directly against a fake client.
 */
export function createTableNode(
	ref: OdbcTableRef,
	client: IOdbcQueryClient,
	host: IOdbcPreviewHost
): positron.DataConnectionNode {
	return {
		name: ref.name,
		kind: ref.kind === 'view'
			? positron.DataConnectionNodeKind.View
			: positron.DataConnectionNodeKind.Table,
		getChildren: async () => [createColumnsGroupNode(ref, client, host)],
		preview: () => host.previewObject(ref),
	};
}

/**
 * Creates the Columns group inside a table or view, listing its columns with their data types.
 * Primary keys are looked up only for base tables: views have none, and asking a driver for the
 * primary keys of a view is an error on some backends rather than an empty result.
 */
function createColumnsGroupNode(
	ref: OdbcTableRef,
	client: IOdbcQueryClient,
	host: IOdbcPreviewHost
): positron.DataConnectionNode {
	return {
		name: 'Columns',
		kind: positron.DataConnectionNodeKind.GroupColumns,
		async getChildren() {
			const catalog = ref.catalog ?? null;
			const schema = ref.schema ?? null;

			const primaryKeys = ref.kind === 'table'
				? await fetchPrimaryKeys(client, catalog, schema, ref.name)
				: new Set<string>();

			const rows = await client.columns(catalog, schema, ref.name, null);
			return rows.map(row => {
				const columnName = String(row['COLUMN_NAME'] ?? '');
				return {
					name: columnName,
					kind: positron.DataConnectionNodeKind.Field,
					dataType: formatDataType(row),
					isPrimaryKey: primaryKeys.has(columnName) || undefined,
					preview: () => host.previewColumn(ref, columnName),
				};
			}).filter(node => node.name.length > 0);
		},
	};
}

/**
 * Returns the column names making up a table's primary key. A driver that does not implement
 * SQLPrimaryKeys reports an error rather than an empty set, and a missing key marker is not worth
 * failing the whole Columns expansion over, so failures degrade to "no primary key".
 */
async function fetchPrimaryKeys(
	client: IOdbcQueryClient,
	catalog: string | null,
	schema: string | null,
	table: string
): Promise<Set<string>> {
	try {
		const rows = await client.primaryKeys(catalog, schema, table);
		return new Set(rows.map(row => String(row['COLUMN_NAME'] ?? '')));
	} catch {
		return new Set();
	}
}

/**
 * Formats a column's type for display, from the SQLColumns result. TYPE_NAME is the backend's own
 * name for the type ("varchar", "int4", "NUMBER"), which is what a user of that backend expects to
 * see; size and scale are appended where they carry information.
 *
 * Exported for tests.
 */
export function formatDataType(row: OdbcRow): string {
	const typeName = String(row['TYPE_NAME'] ?? '').trim();
	if (typeName.length === 0) {
		return '';
	}

	// A driver that already spells out the parameters (e.g. "varchar(255)") needs nothing added.
	if (typeName.includes('(')) {
		return typeName;
	}

	const size = toNumber(row['COLUMN_SIZE']);
	const scale = toNumber(row['DECIMAL_DIGITS']);

	if (size !== undefined && scale !== undefined && scale > 0) {
		return `${typeName}(${size},${scale})`;
	}
	// Size is reported for every type, including ones where it is an artifact of the ODBC type
	// mapping (an integer's "size" is its digit count). Only append it for the types where it is
	// something the user set.
	if (size !== undefined && /char|binary|string/i.test(typeName)) {
		return `${typeName}(${size})`;
	}
	return typeName;
}

function toNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'bigint') {
		return Number(value);
	}
	return undefined;
}

/**
 * Distinct values in first-seen order, preserving `undefined` as its own value (it means "this
 * backend does not use this level", which is different from any named catalog or schema).
 */
function distinct(values: readonly (string | undefined)[]): (string | undefined)[] {
	const seen = new Set<string | undefined>();
	const result: (string | undefined)[] = [];
	for (const value of values) {
		if (!seen.has(value)) {
			seen.add(value);
			result.push(value);
		}
	}
	return result.sort((a, b) => (a ?? '').localeCompare(b ?? ''));
}
