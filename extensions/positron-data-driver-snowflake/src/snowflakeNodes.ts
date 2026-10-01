/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Schema-tree node builders for a Snowflake connection. A Snowflake connection can see every database
// the active role can access, so the tree is always cross-database: the root is a "Databases" group,
// and everything under it is enumerated with SHOW/DESCRIBE metadata commands.
//
// Browsing deliberately uses SHOW (SHOW DATABASES / SCHEMAS / TABLES / VIEWS / SEMANTIC VIEWS /
// STAGES), DESCRIBE, and LIST rather than SELECTs against INFORMATION_SCHEMA. INFORMATION_SCHEMA views
// require an active warehouse (compute), so querying them fails with "No active warehouse selected in
// the current session" whenever the connection has no warehouse -- and warehouse is an optional
// connection field. SHOW/DESCRIBE/LIST run on the cloud-services layer and need no warehouse, so the
// tree expands regardless. (Previewing data in the Data Explorer still needs a warehouse, since that
// runs a real SELECT.) Each command is scoped by fully-qualified object name, so it works no matter
// which database or schema the session currently has selected. Snowflake does not enforce primary keys, so no primary-key detection
// is attempted and field nodes are never marked as primary keys.
//
// Each object node keeps the row its group's SHOW returned for it: the full (not TERSE) SHOW carries
// the owner, comment, and kind-specific facts the node's details show, so clicking a node costs no
// further round-trip for them.

import * as vscode from 'vscode';
import * as positron from 'positron';
import { SnowflakeClient } from './snowflakeClient.js';
import { formatFileSize } from './fileSize.js';

/** Quotes and escapes an identifier for Snowflake by doubling embedded double-quotes. */
function quoteIdentifier(name: string): string {
	return '"' + name.replace(/"/g, '""') + '"';
}

/** Builds a double-quoted two-part `"<db>"."<schema>"` reference. */
function schemaRef(database: string, schemaName: string): string {
	return `${quoteIdentifier(database)}.${quoteIdentifier(schemaName)}`;
}

/** Builds a double-quoted three-part `"<db>"."<schema>"."<name>"` reference. */
function objectRef(database: string, schemaName: string, name: string): string {
	return `${schemaRef(database, schemaName)}.${quoteIdentifier(name)}`;
}

/**
 * The most files a stage's listing shows. LIST has no limit of its own and a stage can hold millions
 * of files, so the listing is cut short here, and the tree says so.
 */
const MAX_STAGE_FILES = 10000;

/**
 * The capability a table/view/column node needs to open itself in the Data Explorer. Implemented by
 * SnowflakeConnection, which owns the dataset registration. `client` is the client the node was built
 * against; `database` is the database the object lives in, so previews use a three-part reference.
 */
export interface ISnowflakePreviewHost {
	/** Opens the given table or view in the Data Explorer, returning its dataset id. */
	previewObject(client: SnowflakeClient, database: string, schemaName: string, tableName: string, kind: 'table' | 'view'): Promise<string>;
	/** Opens a single column of the given table or view in the Data Explorer, returning its dataset id. */
	previewColumn(client: SnowflakeClient, database: string, schemaName: string, tableName: string, kind: 'table' | 'view', columnName: string): Promise<string>;
}

/**
 * Creates the root "Databases" group node, listing every database the connection's role can access.
 * Uses SHOW DATABASES so no current-database context is required.
 */
export function createDatabasesGroupNode(client: SnowflakeClient, host: ISnowflakePreviewHost): positron.DataConnectionNode {
	return {
		name: vscode.l10n.t('Databases'),
		kind: positron.DataConnectionNodeKind.GroupDatabases,
		async getChildren() {
			// SHOW returns a row per database with a lowercase `name` column; the row is kept for the
			// database's details.
			const result = await client.query('SHOW DATABASES');
			return sortByName(result.rows)
				.map(row => createDatabaseNode(client, host, String(row.name), row));
		},
	};
}

/**
 * Creates a database node that expands to a single "Schemas" group. Exported so unit tests can
 * construct a database node directly against a mocked client.
 * @param showRow The database's row from SHOW DATABASES, for its details.
 */
export function createDatabaseNode(client: SnowflakeClient, host: ISnowflakePreviewHost, database: string, showRow: Record<string, unknown> = {}): positron.DataConnectionNode {
	const path = quoteIdentifier(database);
	return {
		name: database,
		kind: positron.DataConnectionNodeKind.Database,
		path,
		async getChildren() {
			return [createSchemasGroupNode(client, host, database)];
		},
		async getDetails() {
			return {
				description: vscode.l10n.t('Database'),
				sections: propertiesSection([
					{ name: vscode.l10n.t('Path'), value: path },
					{ name: vscode.l10n.t('Kind'), value: showValue(showRow.kind) },
					{ name: vscode.l10n.t('Owner'), value: showValue(showRow.owner) },
					{ name: vscode.l10n.t('Created'), value: showValue(showRow.created_on) },
					{ name: vscode.l10n.t('Origin'), value: showValue(showRow.origin) },
					{ name: vscode.l10n.t('Options'), value: showValue(showRow.options) },
					{ name: vscode.l10n.t('Retention Time (Days)'), value: showValue(showRow.retention_time) },
					{ name: vscode.l10n.t('Comment'), value: showValue(showRow.comment) },
				]),
			};
		},
	};
}

/** Creates the "Schemas" group inside a database node, via `SHOW SCHEMAS`. */
export function createSchemasGroupNode(client: SnowflakeClient, host: ISnowflakePreviewHost, database: string): positron.DataConnectionNode {
	return {
		name: vscode.l10n.t('Schemas'),
		kind: positron.DataConnectionNodeKind.GroupSchemas,
		async getChildren() {
			// SHOW runs without a warehouse; SHOW returns a lowercase `name` column. Every schema is
			// listed, including INFORMATION_SCHEMA -- it is a browsable schema, not noise to hide.
			const result = await client.query(`SHOW SCHEMAS IN DATABASE ${quoteIdentifier(database)}`);
			return sortByName(result.rows)
				.map(row => createSchemaNode(client, host, database, String(row.name), row));
		},
	};
}

/**
 * Creates a schema node that expands to Tables, Views, Semantic Views, and Stages groups. Exported so
 * unit tests can construct a schema node directly against a mocked client.
 * @param showRow The schema's row from SHOW SCHEMAS, for its details.
 */
export function createSchemaNode(client: SnowflakeClient, host: ISnowflakePreviewHost, database: string, schemaName: string, showRow: Record<string, unknown> = {}): positron.DataConnectionNode {
	const path = schemaRef(database, schemaName);
	return {
		name: schemaName,
		kind: positron.DataConnectionNodeKind.Schema,
		path,
		async getDetails() {
			return {
				description: vscode.l10n.t('Schema'),
				sections: propertiesSection([
					{ name: vscode.l10n.t('Path'), value: path },
					{ name: vscode.l10n.t('Owner'), value: showValue(showRow.owner) },
					{ name: vscode.l10n.t('Created'), value: showValue(showRow.created_on) },
					{ name: vscode.l10n.t('Options'), value: showValue(showRow.options) },
					{ name: vscode.l10n.t('Retention Time (Days)'), value: showValue(showRow.retention_time) },
					{ name: vscode.l10n.t('Comment'), value: showValue(showRow.comment) },
				]),
			};
		},
		async getChildren() {
			return [
				createTablesGroupNode(client, host, database, schemaName),
				createViewsGroupNode(client, host, database, schemaName),
				createSemanticViewsGroupNode(client, host, database, schemaName),
				createStagesGroupNode(client, database, schemaName),
			];
		},
	};
}

/** Creates the "Tables" group inside a schema. Lists base tables via `SHOW TABLES`. */
function createTablesGroupNode(client: SnowflakeClient, host: ISnowflakePreviewHost, database: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: vscode.l10n.t('Tables'),
		kind: positron.DataConnectionNodeKind.GroupTables,
		async getChildren() {
			// SHOW TABLES lists only base tables (views come from SHOW VIEWS) and needs no warehouse.
			const result = await client.query(`SHOW TABLES IN SCHEMA ${schemaRef(database, schemaName)}`);
			return sortByName(result.rows)
				.map(row => createRelationNode(client, host, database, schemaName, row, 'table'));
		},
	};
}

/** Creates the "Views" group inside a schema. Lists views, materialized ones included, via `SHOW VIEWS`. */
function createViewsGroupNode(client: SnowflakeClient, host: ISnowflakePreviewHost, database: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: vscode.l10n.t('Views'),
		kind: positron.DataConnectionNodeKind.GroupViews,
		async getChildren() {
			const result = await client.query(`SHOW VIEWS IN SCHEMA ${schemaRef(database, schemaName)}`);
			return sortByName(result.rows)
				.map(row => createRelationNode(client, host, database, schemaName, row, 'view'));
		},
	};
}

/**
 * Creates the "Semantic Views" group inside a schema. Lists semantic views via `SHOW SEMANTIC VIEWS`,
 * which, like the other SHOW commands, needs no warehouse. Semantic views are a separate object type
 * from views -- SHOW VIEWS does not return them. A semantic view holds definitions rather than rows,
 * so it has no Data Explorer preview of its own; the preview host is for its logical tables.
 */
function createSemanticViewsGroupNode(client: SnowflakeClient, host: ISnowflakePreviewHost, database: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: vscode.l10n.t('Semantic Views'),
		kind: positron.DataConnectionNodeKind.GroupSemanticViews,
		async getChildren() {
			const result = await client.query(`SHOW SEMANTIC VIEWS IN SCHEMA ${schemaRef(database, schemaName)}`);
			// Each row is kept with its node: it carries the owner, creation time, and comment the
			// semantic view's details show.
			return sortByName(result.rows)
				.map(row => createSemanticViewNode(client, host, database, schemaName, row));
		},
	};
}

/** A member of a semantic view (logical table, relationship, dimension, fact, filter, or metric). */
interface ISemanticViewMember {
	/** The member's name. */
	name: string;
	/** The logical table the member belongs to; unset for logical tables and view-level members. */
	table?: string;
	/** The member's properties (e.g. DATA_TYPE, EXPRESSION), keyed by property name. */
	properties: Map<string, string>;
}

/**
 * The members of a semantic view, bucketed the way Snowsight presents them, each in definition
 * order. Dimensions, time dimensions, facts, named filters, and metrics belong to a logical table
 * (see ISemanticViewMember.table); relationships and derived metrics belong to the view as a whole.
 */
interface ISemanticViewMembers {
	tables: ISemanticViewMember[];
	dimensions: ISemanticViewMember[];
	timeDimensions: ISemanticViewMember[];
	facts: ISemanticViewMember[];
	namedFilters: ISemanticViewMember[];
	metrics: ISemanticViewMember[];
	derivedMetrics: ISemanticViewMember[];
	relationships: ISemanticViewMember[];
}

/**
 * The parts of a semantic view's Cortex Analyst extension this driver reads. A semantic view built
 * from a Cortex Analyst semantic model keeps what SQL has no clause for -- named filters, and which
 * dimensions are time dimensions, among other things -- as JSON in `WITH EXTENSION (CA = '...')`.
 * Every field is optional: the JSON is the model author's, not a schema Snowflake enforces.
 */
interface ICortexAnalystExtension {
	tables?: {
		name?: string;
		time_dimensions?: { name?: string }[];
		filters?: { name?: string; description?: string; expr?: string; synonyms?: string[] }[];
	}[];
}

/**
 * Parses a semantic view's Cortex Analyst extension, or returns undefined when the value isn't one.
 */
function parseCortexAnalystExtension(value: unknown): ICortexAnalystExtension | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(value);
		if (parsed && typeof parsed === 'object' && Array.isArray((parsed as ICortexAnalystExtension).tables)) {
			return parsed as ICortexAnalystExtension;
		}
	} catch {
		// Not JSON; not an extension this driver reads.
	}
	return undefined;
}

/**
 * Builds a case-insensitive key for a table-scoped member. The extension's names need not match
 * DESCRIBE's case (it spells relationships in lowercase, for one).
 */
function memberKey(table: string | undefined, name: string): string {
	return JSON.stringify([table?.toUpperCase() ?? null, name.toUpperCase()]);
}

/**
 * Whether a dimension is a time dimension, when the semantic view has no extension to say so.
 * DESCRIBE reports time dimensions as ordinary dimensions, so they are told apart by their data
 * type: a date, time, or timestamp.
 */
function looksLikeTimeDimension(member: ISemanticViewMember): boolean {
	return /^(DATE|TIME|TIMESTAMP|DATETIME)/i.test(member.properties.get('DATA_TYPE') ?? '');
}

/**
 * Parses the rows of `DESCRIBE SEMANTIC VIEW` into members. DESCRIBE returns one row per property,
 * with columns `object_kind`, `object_name`, `parent_entity`, `property`, and `property_value`, so a
 * member's rows are collapsed into one entry. Rows with no object kind describe the semantic view
 * itself (e.g. its comment) and are skipped, as are kinds this parser does not know. The Cortex
 * Analyst extension, when the view has one, supplies the named filters and says which dimensions are
 * time dimensions (see ICortexAnalystExtension). Exported for unit tests.
 */
export function parseSemanticViewDescription(rows: Record<string, unknown>[]): ISemanticViewMembers {
	const members: ISemanticViewMembers = {
		tables: [], dimensions: [], timeDimensions: [], facts: [], namedFilters: [], metrics: [], derivedMetrics: [], relationships: [],
	};
	// Dimensions and metrics are sorted into their final buckets after every row is read: whether a
	// dimension is a time dimension depends on its DATA_TYPE property, which may arrive on any of
	// its rows.
	const dimensions: ISemanticViewMember[] = [];
	const metrics: ISemanticViewMember[] = [];
	const byKey = new Map<string, ISemanticViewMember>();
	let extension: ICortexAnalystExtension | undefined;
	for (const row of rows) {
		const objectKind = row.object_kind ? String(row.object_kind) : '';
		// The Cortex Analyst extension comes back as one row holding the whole JSON document.
		if (objectKind === 'EXTENSION') {
			extension ??= parseCortexAnalystExtension(row.property_value);
			continue;
		}
		let bucket: ISemanticViewMember[];
		switch (objectKind) {
			case 'TABLE': bucket = members.tables; break;
			case 'RELATIONSHIP': bucket = members.relationships; break;
			case 'FACT': bucket = members.facts; break;
			case 'DIMENSION': bucket = dimensions; break;
			case 'TIME_DIMENSION': bucket = members.timeDimensions; break;
			case 'METRIC': bucket = metrics; break;
			case 'DERIVED_METRIC': bucket = members.derivedMetrics; break;
			default:
				// Named filters are matched loosely, as any kind naming a filter (FILTER, NAMED_FILTER).
				if (objectKind.includes('FILTER')) {
					bucket = members.namedFilters;
					break;
				}
				continue;
		}

		const name = String(row.object_name);
		const table = row.parent_entity ? String(row.parent_entity) : undefined;
		const key = JSON.stringify([objectKind, table ?? null, name]);
		let member = byKey.get(key);
		if (!member) {
			member = { name, table, properties: new Map() };
			byKey.set(key, member);
			bucket.push(member);
		}
		if (row.property) {
			member.properties.set(String(row.property), row.property_value === null || row.property_value === undefined ? '' : String(row.property_value));
		}
	}

	// The extension says which of a table's dimensions are time dimensions -- but only for a table
	// whose entry lists them. An entry can leave the list out (a model whose extension only carries
	// filters, say), and then says nothing either way, so that table falls back to the data type, as
	// a view with no extension does.
	const extensionTables = extension?.tables ?? [];
	const timeDimensionsByTable = new Map<string, Set<string>>();
	for (const table of extensionTables) {
		if (table.name && Array.isArray(table.time_dimensions)) {
			timeDimensionsByTable.set(
				table.name.toUpperCase(),
				new Set(table.time_dimensions.filter(dimension => dimension.name).map(dimension => dimension.name!.toUpperCase()))
			);
		}
	}
	for (const dimension of dimensions) {
		const listed = dimension.table ? timeDimensionsByTable.get(dimension.table.toUpperCase()) : undefined;
		const isTime = listed ? listed.has(dimension.name.toUpperCase()) : looksLikeTimeDimension(dimension);
		(isTime ? members.timeDimensions : members.dimensions).push(dimension);
	}

	// Named filters live only in the extension. Each is attached to the logical table it names, spelled
	// the way DESCRIBE spells that table, and given the properties a member's details and overview
	// read: its expression, its description as a comment, and its synonyms. A filter naming a table
	// DESCRIBE doesn't report is dropped: a filter is only shown under its table, and there is no such
	// table to show it under.
	const tableNames = new Map(members.tables.map(table => [table.name.toUpperCase(), table.name]));
	const filterKeys = new Set(members.namedFilters.map(filter => memberKey(filter.table, filter.name)));
	for (const table of extensionTables) {
		const tableName = table.name ? tableNames.get(table.name.toUpperCase()) : undefined;
		if (!tableName) {
			continue;
		}
		for (const filter of table.filters ?? []) {
			if (!filter.name || filterKeys.has(memberKey(tableName, filter.name))) {
				continue;
			}
			const properties = new Map<string, string>();
			if (filter.expr) {
				properties.set('EXPRESSION', filter.expr);
			}
			if (filter.description) {
				properties.set('COMMENT', filter.description);
			}
			if (filter.synonyms && filter.synonyms.length > 0) {
				properties.set('SYNONYMS', JSON.stringify(filter.synonyms));
			}
			members.namedFilters.push({ name: filter.name, table: tableName, properties });
			filterKeys.add(memberKey(tableName, filter.name));
		}
	}
	// A metric with no logical table is defined at the view level, over other metrics: a derived
	// metric, whether or not DESCRIBE calls it one.
	for (const metric of metrics) {
		(metric.table ? members.metrics : members.derivedMetrics).push(metric);
	}
	return members;
}

/**
 * Creates a semantic view node. Expanding it runs a single `DESCRIBE SEMANTIC VIEW` and returns the
 * view's groups in Snowsight's order: Logical Tables, Derived Metrics, Relationships. Each logical
 * table in turn holds its own Dimensions, Time Dimensions, Facts, Named Filters, and Metrics. Every
 * group is built from that one result, so expanding them costs no further round-trips, and every
 * group is shown, even when empty, so every semantic view has the same layout -- the same reason a
 * schema always shows all of its groups.
 */
function createSemanticViewNode(
	client: SnowflakeClient,
	host: ISnowflakePreviewHost,
	database: string,
	schemaName: string,
	showRow: Record<string, unknown>
): positron.DataConnectionNode {
	const semanticViewName = String(showRow.name);
	const semanticViewRef = objectRef(database, schemaName, semanticViewName);

	// Both loads are shared across the node's lifetime: expanding the node and clicking it (as many
	// times as the user likes) cost one DESCRIBE between them, and GET_DDL -- a SELECT, which may
	// need, and resume, a warehouse -- runs once rather than on every click. Refreshing the tree
	// rebuilds the node, and with it these, so a changed definition is picked up there.
	const describe = memoizeAsync(async () =>
		parseSemanticViewDescription((await client.query(`DESCRIBE SEMANTIC VIEW ${semanticViewRef}`)).rows));
	// The name is passed as a bind, not spliced into the string literal: Snowflake string literals
	// treat backslashes as escapes as well as quotes, so escaping quotes alone isn't enough.
	const ddl = memoizeAsync(async () =>
		showValue((await client.query(`SELECT GET_DDL('SEMANTIC_VIEW', ?) AS DDL`, [semanticViewRef])).rows[0]?.DDL) ?? '');

	return {
		name: semanticViewName,
		kind: positron.DataConnectionNodeKind.SemanticView,
		path: semanticViewRef,
		async getDetails() {
			return semanticViewDetails(showRow, describe, ddl);
		},
		async getChildren() {
			const members = await describe();
			const K = positron.DataConnectionNodeKind;
			return [
				createSemanticViewMemberGroupNode(vscode.l10n.t('Logical Tables'), K.GroupLogicalTables, members.tables, table =>
					createLogicalTableNode(client, host, table, members)),
				createSemanticViewMemberGroupNode(vscode.l10n.t('Derived Metrics'), K.GroupDerivedMetrics, members.derivedMetrics, metric =>
					createSemanticViewMemberNode(metric, K.Metric, vscode.l10n.t('Derived metric'))),
				createSemanticViewMemberGroupNode(vscode.l10n.t('Relationships'), K.GroupRelationships, members.relationships, relationship =>
					createSemanticViewMemberNode(relationship, K.Relationship, vscode.l10n.t('Relationship'))),
			];
		},
	};
}

/**
 * Memoizes an async load: concurrent and later calls share one result. A failed load is forgotten,
 * so the next call retries it -- a query that failed for want of a warehouse can succeed once one
 * is set.
 */
function memoizeAsync<T>(load: () => Promise<T>): () => Promise<T> {
	let pending: Promise<T> | undefined;
	return () => {
		if (!pending) {
			const attempt = load();
			pending = attempt;
			attempt.catch(() => {
				if (pending === attempt) {
					pending = undefined;
				}
			});
		}
		return pending;
	};
}

/**
 * Parses a DESCRIBE list-valued property (synonyms, key columns), which comes back as a JSON array
 * (e.g. `["E_KEY"]`). Returns undefined when the value isn't one.
 */
function parseJsonList(value: string): string[] | undefined {
	if (!value.startsWith('[')) {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.map(item => String(item)) : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Splits a DESCRIBE list-valued property into its entries: a JSON array, or, failing that, a
 * comma-separated value.
 */
function propertyList(value: string | undefined): string[] {
	if (!value) {
		return [];
	}
	return parseJsonList(value) ?? value.split(',').map(item => item.trim()).filter(item => item.length > 0);
}

/**
 * Builds an overview item for a semantic view member: its name, icon, data type, comment, and
 * expression.
 */
function semanticViewMemberItem(member: ISemanticViewMember, kind: positron.DataConnectionNodeKind): positron.DataConnectionNodeDetailsItem {
	return {
		name: member.name,
		kind,
		dataType: member.properties.get('DATA_TYPE'),
		description: member.properties.get('COMMENT') || undefined,
		code: member.properties.get('EXPRESSION') || undefined,
	};
}

/**
 * Builds an overview item for a relationship. Snowsight reads a relationship as "Many <table> rows
 * map to one <referenced table> row", with the joined key columns beneath; the same is built here
 * from its TABLE, REF_TABLE, FOREIGN_KEY, and REF_KEY properties, when DESCRIBE reports them.
 */
function relationshipItem(relationship: ISemanticViewMember): positron.DataConnectionNodeDetailsItem {
	const table = relationship.properties.get('TABLE') ?? relationship.table;
	const refTable = relationship.properties.get('REF_TABLE');
	const foreignKey = propertyList(relationship.properties.get('FOREIGN_KEY'));
	const refKey = propertyList(relationship.properties.get('REF_KEY'));
	const item: positron.DataConnectionNodeDetailsItem = {
		name: relationship.name,
		kind: positron.DataConnectionNodeKind.Relationship,
		description: relationship.properties.get('COMMENT') || undefined,
	};
	if (table && refTable) {
		item.description ??= vscode.l10n.t('Many {0} rows map to one {1} row.', table, refTable);
		if (foreignKey.length > 0 && foreignKey.length === refKey.length) {
			item.code = foreignKey.map((column, index) => `${table}.${column} = ${refTable}.${refKey[index]}`).join(' AND ');
		}
	}
	return item;
}

/**
 * Builds a collapsible group of semantic view members for the overview, e.g. "Dimensions 4".
 * @param title The group's heading, which is also its group node's name in the tree.
 * @param groupKind The kind of the group's node in the tree.
 * @param kind The kind of the members' nodes.
 * @param members The members.
 * @param emptyText What to show when there are none.
 * @param treeParent The tree path, below the semantic view, of the node the group's node sits under.
 * @param toItem Builds each member's overview item.
 */
function semanticViewMemberGroup(
	title: string,
	groupKind: positron.DataConnectionNodeKind,
	kind: positron.DataConnectionNodeKind,
	members: ISemanticViewMember[],
	emptyText: string,
	treeParent: SemanticViewTreePath,
	toItem: (member: ISemanticViewMember) => positron.DataConnectionNodeDetailsItem = member => semanticViewMemberItem(member, kind)
): positron.DataConnectionNodeDetailsGroupSection {
	return {
		kind: 'group',
		title,
		count: members.length,
		collapsible: true,
		// The Overview's groups mirror the tree's, down to their (localized) names, so each heading
		// can show its own node in the tree.
		treePath: [...treeParent, { kind: groupKind, name: title }],
		sections: [{ kind: 'items', items: members.map(toItem), emptyText }],
	};
}

/** A path to a node below a semantic view in the tree: the kind and name of each node on the way. */
type SemanticViewTreePath = { kind: positron.DataConnectionNodeKind; name: string }[];

/**
 * Formats a SHOW column value for display. Timestamps come back from the SDK as Dates.
 */
function showValue(value: unknown): string | undefined {
	if (value === null || value === undefined || value === '') {
		return undefined;
	}
	return value instanceof Date ? value.toLocaleString() : String(value);
}

/**
 * Reads a SHOW flag column. SHOW reports flags inconsistently across commands -- 'Y' and 'N' in some,
 * 'true' and 'false' or 'ON' and 'OFF' in others -- so each is read as yes or no. Returns undefined
 * for a value that is neither.
 */
function parseFlag(value: unknown): boolean | undefined {
	switch (showValue(value)?.toUpperCase()) {
		case 'Y': case 'YES': case 'TRUE': case 'ON':
			return true;
		case 'N': case 'NO': case 'FALSE': case 'OFF':
			return false;
		default:
			return undefined;
	}
}

/** Formats a SHOW flag column for display as yes or no (see parseFlag), or as it came otherwise. */
function showFlag(value: unknown): string | undefined {
	const flag = parseFlag(value);
	return flag === undefined ? showValue(value) : flag ? vscode.l10n.t('Yes') : vscode.l10n.t('No');
}

/** Formats a SHOW count column (e.g. a table's rows) for display, with digit grouping. */
function showCount(value: unknown): string | undefined {
	const count = Number(showValue(value));
	return showValue(value) === undefined || !isFinite(count) ? showValue(value) : count.toLocaleString();
}

/** Formats a SHOW or LIST size column for display, or returns undefined when it has none. */
function showSize(value: unknown): string | undefined {
	const text = showValue(value);
	const bytes = Number(text);
	return text === undefined || !isFinite(bytes) ? text : formatFileSize(bytes);
}

/**
 * Builds a properties section from name/value pairs, leaving out the pairs with no value. Returns
 * no section at all when none has one.
 */
function propertiesSection(properties: { name: string; value: string | undefined }[]): positron.DataConnectionNodeDetailsSection[] {
	const present = properties.filter((property): property is { name: string; value: string } => property.value !== undefined);
	return present.length > 0 ? [{ kind: 'properties', properties: present }] : [];
}

/** Sorts SHOW rows by their `name` column. */
function sortByName(rows: Record<string, unknown>[]): Record<string, unknown>[] {
	return [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * Runs a details load that may fail, turning a failure into a section saying why, so the rest of the
 * details still show.
 */
async function settleSections(load: () => Promise<positron.DataConnectionNodeDetailsSection[]>): Promise<positron.DataConnectionNodeDetailsSection[]> {
	try {
		return await load();
	} catch (error) {
		return [{ kind: 'properties', properties: [{ name: vscode.l10n.t('Unavailable'), value: error instanceof Error ? error.message : String(error) }] }];
	}
}

/**
 * Builds the details of a semantic view: an Overview laid out the way Snowsight lays one out --
 * its owner and comment, then each logical table with its dimensions, time dimensions, facts,
 * named filters, and metrics, then derived metrics and relationships -- and a Definition holding
 * its DDL.
 *
 * The DDL comes from GET_DDL, a SELECT, which (unlike the SHOW and DESCRIBE commands the tree uses)
 * may need a warehouse. A connection without one still gets the Overview; the Definition says why it
 * is empty instead.
 * @param showRow The semantic view's row from SHOW SEMANTIC VIEWS.
 * @param describe Loads the semantic view's members (DESCRIBE SEMANTIC VIEW).
 * @param loadDdl Loads the semantic view's DDL (GET_DDL).
 */
async function semanticViewDetails(
	showRow: Record<string, unknown>,
	describe: () => Promise<ISemanticViewMembers>,
	loadDdl: () => Promise<string>
): Promise<positron.DataConnectionNodeDetails> {
	const K = positron.DataConnectionNodeKind;
	const [members, ddl] = await Promise.all([
		describe(),
		loadDdl().then(
			text => ({ ok: true as const, text }),
			error => ({ ok: false as const, text: error instanceof Error ? error.message : String(error) })
		),
	]);

	const overview: positron.DataConnectionNodeDetailsSection[] = [];
	const properties = [
		{ name: vscode.l10n.t('Owner'), value: showValue(showRow.owner) },
		{ name: vscode.l10n.t('Created'), value: showValue(showRow.created_on) },
		{ name: vscode.l10n.t('Comment'), value: showValue(showRow.comment) },
	].filter((property): property is { name: string; value: string } => property.value !== undefined);
	if (properties.length > 0) {
		overview.push({ kind: 'properties', properties });
	}

	const logicalTablesPath: SemanticViewTreePath = [{ kind: K.GroupLogicalTables, name: vscode.l10n.t('Logical Tables') }];
	overview.push({
		kind: 'group',
		title: vscode.l10n.t('Logical Tables'),
		count: members.tables.length,
		treePath: logicalTablesPath,
		sections: members.tables.map((table): positron.DataConnectionNodeDetailsSection => {
			const tablePath: SemanticViewTreePath = [...logicalTablesPath, { kind: K.LogicalTable, name: table.name }];
			const own = (bucket: ISemanticViewMember[]) => bucket.filter(member => member.table === table.name);
			const baseDatabase = table.properties.get('BASE_TABLE_DATABASE_NAME');
			const baseSchema = table.properties.get('BASE_TABLE_SCHEMA_NAME');
			const baseTable = table.properties.get('BASE_TABLE_NAME');
			const tableProperties = [
				{ name: vscode.l10n.t('Base Table'), value: baseDatabase && baseSchema && baseTable ? `${baseDatabase}.${baseSchema}.${baseTable}` : undefined },
				{ name: vscode.l10n.t('Primary Key'), value: table.properties.get('PRIMARY_KEY') ? propertyValue(table.properties.get('PRIMARY_KEY')!) : undefined },
				{ name: vscode.l10n.t('Comment'), value: table.properties.get('COMMENT') || undefined },
			].filter((property): property is { name: string; value: string } => property.value !== undefined);
			return {
				kind: 'group',
				title: table.name,
				treePath: tablePath,
				sections: [
					...(tableProperties.length > 0 ? [{ kind: 'properties' as const, properties: tableProperties }] : []),
					...logicalTableMemberGroups().map(group =>
						semanticViewMemberGroup(group.title, group.groupKind, group.kind, own(group.members(members)), group.emptyText, tablePath)),
				],
			};
		}),
	});
	// The view-level groups sit beside Logical Tables as headings of the page, so like it they don't
	// collapse; only the groups within a table do, as in Snowsight.
	overview.push({ ...semanticViewMemberGroup(vscode.l10n.t('Derived Metrics'), K.GroupDerivedMetrics, K.Metric, members.derivedMetrics, vscode.l10n.t('No derived metrics'), []), collapsible: false });
	overview.push({ ...semanticViewMemberGroup(vscode.l10n.t('Relationships'), K.GroupRelationships, K.Relationship, members.relationships, vscode.l10n.t('No relationships'), [], relationshipItem), collapsible: false });

	// GET_DDL answers with nothing, rather than failing, for a role that can see the semantic view
	// but not read its definition; that reads as unavailable too, not as a blank definition.
	const unavailable = !ddl.ok
		? ddl.text
		: ddl.text.trim().length === 0
			? vscode.l10n.t('The definition is not available to the current role.')
			: undefined;
	const definition: positron.DataConnectionNodeDetailsSection = unavailable === undefined
		? { kind: 'code', languageId: 'sql', code: ddl.text }
		: { kind: 'properties', properties: [{ name: vscode.l10n.t('Unavailable'), value: unavailable }] };

	return {
		// Just what the node is: where it lives is the details editor's breadcrumbs.
		description: vscode.l10n.t('Semantic view'),
		sections: [],
		tabs: [
			{ title: vscode.l10n.t('Overview'), sections: overview },
			{ title: vscode.l10n.t('Definition'), sections: [definition] },
		],
	};
}

/**
 * One of the groups a logical table holds its members in. Both the tree (createLogicalTableNode)
 * and the semantic view's Overview (semanticViewDetails) are built from this one list, so their
 * groups can't drift apart -- the Overview's "show in the tree" buttons find their groups by name.
 */
interface ILogicalTableMemberGroup {
	/** The group's name, in the tree and as the Overview's heading. */
	readonly title: string;
	/** The group node's kind. */
	readonly groupKind: positron.DataConnectionNodeKind;
	/** The members' node kind. */
	readonly kind: positron.DataConnectionNodeKind;
	/** What each member is, for its details, e.g. "Metric". */
	readonly description: string;
	/** What the Overview shows when the group is empty. */
	readonly emptyText: string;
	/** Picks the group's members, of every table, out of the semantic view's. */
	readonly members: (members: ISemanticViewMembers) => ISemanticViewMember[];
}

/**
 * The groups a logical table holds its members in, in Snowsight's order. A function rather than a
 * constant so the strings are localized when used, not when the module loads.
 */
function logicalTableMemberGroups(): readonly ILogicalTableMemberGroup[] {
	const K = positron.DataConnectionNodeKind;
	return [
		{ title: vscode.l10n.t('Dimensions'), groupKind: K.GroupDimensions, kind: K.Dimension, description: vscode.l10n.t('Dimension'), emptyText: vscode.l10n.t('No dimensions'), members: members => members.dimensions },
		{ title: vscode.l10n.t('Time Dimensions'), groupKind: K.GroupTimeDimensions, kind: K.TimeDimension, description: vscode.l10n.t('Time dimension'), emptyText: vscode.l10n.t('No time dimensions'), members: members => members.timeDimensions },
		{ title: vscode.l10n.t('Facts'), groupKind: K.GroupFacts, kind: K.Fact, description: vscode.l10n.t('Fact'), emptyText: vscode.l10n.t('No facts'), members: members => members.facts },
		{ title: vscode.l10n.t('Named Filters'), groupKind: K.GroupNamedFilters, kind: K.NamedFilter, description: vscode.l10n.t('Named filter'), emptyText: vscode.l10n.t('No named filters'), members: members => members.namedFilters },
		{ title: vscode.l10n.t('Metrics'), groupKind: K.GroupMetrics, kind: K.Metric, description: vscode.l10n.t('Metric'), emptyText: vscode.l10n.t('No metrics'), members: members => members.metrics },
	];
}

/** Creates a group of semantic view members. */
function createSemanticViewMemberGroupNode(
	name: string,
	kind: positron.DataConnectionNodeKind,
	members: ISemanticViewMember[],
	createMemberNode: (member: ISemanticViewMember) => positron.DataConnectionNode
): positron.DataConnectionNode {
	return {
		name,
		kind,
		async getChildren() {
			return members.map(createMemberNode);
		},
	};
}

/**
 * Turns a DESCRIBE property name into a label: `BASE_TABLE_NAME` becomes "Base Table Name".
 */
function propertyLabel(property: string): string {
	return property
		.toLowerCase()
		.split('_')
		.filter(word => word.length > 0)
		.map(word => word[0].toUpperCase() + word.slice(1))
		.join(' ');
}

/**
 * Formats a DESCRIBE property value for display. List-valued properties (synonyms, key columns)
 * come back as JSON arrays, e.g. `["REVENUE","SALES"]`, which read better as a plain list. Anything
 * else is shown as it came; in particular it is not split on commas, which types like NUMBER(38,0)
 * contain.
 */
function propertyValue(value: string): string {
	return parseJsonList(value)?.join(', ') ?? value;
}

/**
 * Builds the details of a semantic view member from its DESCRIBE properties. Every property is
 * shown, in DESCRIBE order, rather than a hand-picked few: which properties a member has varies by
 * kind and has grown across Snowflake releases, and showing what DESCRIBE returns keeps the page
 * complete without this driver tracking that. The one exception is EXPRESSION -- the SQL that
 * defines a fact, dimension, filter, or metric, and usually the thing the user came to read --
 * which gets a code section of its own.
 * @param member The member.
 * @param description What the member is, e.g. "Metric". (Where it lives is the details editor's
 * breadcrumbs.)
 * @param qualified Whether the member has a `<table>.<name>` qualified name. Relationships don't:
 * their parent entity is the table they join from, but they are named at the view level.
 */
function semanticViewMemberDetails(member: ISemanticViewMember, description: string, qualified: boolean): positron.DataConnectionNodeDetails {
	const properties: { name: string; value: string }[] = [];
	// A member of a logical table is named `<table>.<name>` in a SEMANTIC_VIEW(...) query. The tree
	// shows the bare name under its table, so the qualified one is spelled out here. DESCRIBE reports
	// the table as the member's parent entity; some kinds also carry it as a TABLE property, which is
	// skipped below so it isn't listed twice.
	if (member.table) {
		properties.push({ name: vscode.l10n.t('Table'), value: member.table });
		if (qualified) {
			properties.push({ name: vscode.l10n.t('Qualified Name'), value: `${member.table}.${member.name}` });
		}
	}
	for (const [property, value] of member.properties) {
		if (property === 'EXPRESSION' || (property === 'TABLE' && member.table)) {
			continue;
		}
		properties.push({ name: propertyLabel(property), value: propertyValue(value) });
	}

	const sections: positron.DataConnectionNodeDetailsSection[] = [];
	if (properties.length > 0) {
		sections.push({ kind: 'properties', properties });
	}
	const expression = member.properties.get('EXPRESSION');
	if (expression) {
		sections.push({ kind: 'code', title: vscode.l10n.t('Expression'), languageId: 'sql', code: expression });
	}
	return { description, sections };
}

/**
 * Creates a leaf node for a semantic view member, carrying its DATA_TYPE (when it has one) and its
 * details. Members of a logical table are shown under it, so they go by their bare name.
 * @param member The member.
 * @param kind The node kind.
 * @param description What the member is, for its details, e.g. "Metric".
 */
function createSemanticViewMemberNode(
	member: ISemanticViewMember,
	kind: positron.DataConnectionNodeKind,
	description: string
): positron.DataConnectionNode {
	return {
		name: member.name,
		kind,
		dataType: member.properties.get('DATA_TYPE'),
		async getDetails() {
			return semanticViewMemberDetails(member, description, kind !== positron.DataConnectionNodeKind.Relationship);
		},
	};
}

/**
 * Creates a logical table node. It expands to the table's own members -- Dimensions, Time
 * Dimensions, Facts, Named Filters, and Metrics, in Snowsight's order -- and has details.
 *
 * A logical table is only a name inside the semantic view and cannot be queried itself, but it
 * aliases exactly one base table or view. When DESCRIBE reported that base object, the node shows its
 * three-part name, so it is clear what "Open in Data Explorer" opens: the raw base data rather than
 * the semantic view's model of it.
 * @param client The client.
 * @param host The preview host.
 * @param table The logical table.
 * @param members All of the semantic view's members, from which the table's own are picked.
 */
function createLogicalTableNode(
	client: SnowflakeClient,
	host: ISnowflakePreviewHost,
	table: ISemanticViewMember,
	members: ISemanticViewMembers
): positron.DataConnectionNode {
	const K = positron.DataConnectionNodeKind;
	const own = (bucket: ISemanticViewMember[]) => bucket.filter(member => member.table === table.name);
	const node: positron.DataConnectionNode = {
		name: table.name,
		kind: K.LogicalTable,
		async getChildren() {
			return logicalTableMemberGroups().map(group =>
				createSemanticViewMemberGroupNode(group.title, group.groupKind, own(group.members(members)), member =>
					createSemanticViewMemberNode(member, group.kind, group.description)));
		},
		async getDetails() {
			return semanticViewMemberDetails(table, vscode.l10n.t('Logical table'), false);
		},
	};

	const baseDatabase = table.properties.get('BASE_TABLE_DATABASE_NAME');
	const baseSchema = table.properties.get('BASE_TABLE_SCHEMA_NAME');
	const baseTable = table.properties.get('BASE_TABLE_NAME');
	if (baseDatabase && baseSchema && baseTable) {
		node.dataType = `${baseDatabase}.${baseSchema}.${baseTable}`;
		// What a logical table holds is its definition; its preview opens its base table, which is
		// another object's data. So a double-click keeps its details, and the data is one "Open in
		// Data Explorer" away.
		node.defaultAction = 'details';
		node.preview = () => {
			// The base object may be a table or a view; DESCRIBE does not say which. The kind only tags
			// the dataset id -- the Snowflake preview queries both the same way -- so 'table' is safe.
			return host.previewObject(client, baseDatabase, baseSchema, baseTable, 'table');
		};
	}
	return node;
}

/**
 * Creates the "Stages" group inside a schema. Lists named stages via `SHOW STAGES`. Stages hold files
 * rather than tabular rows, so a stage has no Data Explorer preview; it expands to its files instead.
 * Takes no preview host for that reason.
 */
function createStagesGroupNode(client: SnowflakeClient, database: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: vscode.l10n.t('Stages'),
		kind: positron.DataConnectionNodeKind.GroupStages,
		async getChildren() {
			const result = await client.query(`SHOW STAGES IN SCHEMA ${schemaRef(database, schemaName)}`);
			return sortByName(result.rows)
				.map(row => createStageNode(client, database, schemaName, row));
		},
	};
}

/** A file in a stage, from LIST. */
interface IStageFile {
	/** The file's path below the folder being listed, without a leading slash, e.g. `2024/orders.csv`. */
	path: string;
	/** The file's row from LIST, for its details. */
	row: Record<string, unknown>;
}

/** A folder in a stage's listing: the files directly in it, and its subfolders by name. */
interface IStageFolder {
	folders: Map<string, IStageFolder>;
	files: { name: string; file: IStageFile }[];
}

/**
 * Turns a name LIST reported into the file's path within the stage. LIST names a file in an internal
 * stage by the stage's name and the path (`my_stage/2024/orders.csv`), and a file in an external stage
 * by its full URL (`s3://bucket/prefix/2024/orders.csv`), so the stage's own part is cut off. That
 * part is matched by its segments rather than as a string: the URL SHOW STAGES reports needn't be
 * spelled exactly as LIST spells its names (case, a trailing slash, an Azure host's form), but it
 * names the same location, so it has the same number of segments -- the stage name's one for an
 * internal stage, and the URL's own (bucket or container, then its path) for an external one.
 * Exported for unit tests.
 * @param name The `name` LIST reported.
 * @param stageUrl The stage's URL from SHOW STAGES; empty for an internal stage.
 */
export function stageFilePath(name: string, stageUrl: string | undefined): string {
	const segments = (value: string) => value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/').filter(segment => segment.length > 0);
	const stageSegments = stageUrl ? segments(stageUrl).length : 1;
	const path = segments(name).slice(stageSegments).join('/');
	// A trailing slash marks a folder (see stageFolders), so it is kept.
	return name.endsWith('/') && path.length > 0 ? `${path}/` : path;
}

/**
 * Arranges a stage's files into folders by their `/`-separated paths. A stage has no folders of its
 * own -- LIST returns a flat list of files -- so these are the prefixes the paths share, the way a
 * cloud storage console shows them.
 */
function stageFolders(files: IStageFile[]): IStageFolder {
	const root: IStageFolder = { folders: new Map(), files: [] };
	for (const file of files) {
		const segments = file.path.split('/').filter(segment => segment.length > 0);
		// A path ending in a slash is a folder marker -- the empty object some tools write to make a
		// folder show in a storage console -- so it adds its folders but no file.
		const fileName = file.path.endsWith('/') ? undefined : segments.pop();
		let folder = root;
		for (const segment of segments) {
			let child = folder.folders.get(segment);
			if (!child) {
				child = { folders: new Map(), files: [] };
				folder.folders.set(segment, child);
			}
			folder = child;
		}
		if (fileName !== undefined) {
			folder.files.push({ name: fileName, file });
		}
	}
	return root;
}

/** A stage, as the nodes of its listing need it. */
interface IStageLocation {
	/** The stage's path, e.g. `@"DB"."PUBLIC"."STAGE"`. */
	path: string;
	/** The stage's URL from SHOW STAGES; unset for an internal stage. */
	url: string | undefined;
}

/** Quotes a Snowflake string literal, escaping backslashes as well as single quotes. */
function quoteLiteral(value: string): string {
	return `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`;
}

/**
 * Lists a folder of a stage: its subfolders, then its files, each in name order -- the ordering a
 * file browser uses. LIST always lists everything under the location it's given, with no limit, so
 * only its first MAX_STAGE_FILES rows are read, with a notice saying so. Each folder lists its own
 * prefix when expanded, so refreshing a folder picks up what changed under it.
 *
 * A stage the role can see but not read (no READ on an internal stage, or an external stage whose
 * credentials or integration fail) can't be listed. That isn't a fault in the tree: the stage's
 * details still show, so the listing says why it is empty instead of failing the expand.
 * @param client The client.
 * @param stage The stage.
 * @param prefix The folder's path within the stage, with a trailing slash; empty for the stage itself.
 */
async function listStageFolder(client: SnowflakeClient, stage: IStageLocation, prefix: string): Promise<positron.DataConnectionNode[]> {
	// The quoted form takes any path, spaces and all. LIST runs without a warehouse.
	let listing: { rows: Record<string, unknown>[]; total: number };
	try {
		listing = await client.queryCapped(`LIST ${quoteLiteral(`${stage.path}/${prefix}`)}`, MAX_STAGE_FILES);
	} catch (error) {
		return [{
			name: vscode.l10n.t('Could not list the files: {0}', error instanceof Error ? error.message : String(error)),
			kind: positron.DataConnectionNodeKind.Notice,
		}];
	}
	// LIST matches its location as a string prefix, so the files are kept to the folder's own before
	// they're arranged, in case a name comes back outside it.
	const files = listing.rows
		.map(row => ({ path: stageFilePath(String(row.name), stage.url), row }))
		.filter(file => file.path.startsWith(prefix))
		.map(file => ({ ...file, path: file.path.slice(prefix.length) }));
	const folder = stageFolders(files);

	const nodes: positron.DataConnectionNode[] = [];
	if (listing.total > listing.rows.length) {
		nodes.push({
			name: vscode.l10n.t('Showing the first {0} of {1} files', listing.rows.length.toLocaleString(), listing.total.toLocaleString()),
			kind: positron.DataConnectionNodeKind.Notice,
		});
	}
	for (const name of [...folder.folders.keys()].sort((a, b) => a.localeCompare(b))) {
		const folderPrefix = `${prefix}${name}/`;
		nodes.push({
			name,
			kind: positron.DataConnectionNodeKind.Directory,
			path: `${stage.path}/${folderPrefix}`,
			getChildren: () => listStageFolder(client, stage, folderPrefix),
		});
	}
	for (const { name, file } of [...folder.files].sort((a, b) => a.name.localeCompare(b.name))) {
		nodes.push(createStageFileNode(`${stage.path}/${prefix}${file.path}`, name, file.row));
	}
	return nodes;
}

/**
 * Creates a file node in a stage's listing, with details from its LIST row.
 * @param path The file's path, e.g. `@"DB"."PUBLIC"."STAGE"/2024/orders.csv`.
 * @param name The file's name.
 * @param row The file's row from LIST.
 */
function createStageFileNode(path: string, name: string, row: Record<string, unknown>): positron.DataConnectionNode {
	return {
		name,
		kind: positron.DataConnectionNodeKind.File,
		// The tree renders dataType as a trailing label, which is where a file's size belongs.
		dataType: showSize(row.size),
		path,
		async getDetails() {
			return {
				description: vscode.l10n.t('File'),
				sections: propertiesSection([
					{ name: vscode.l10n.t('Path'), value: path },
					{ name: vscode.l10n.t('Size'), value: showSize(row.size) },
					{ name: vscode.l10n.t('Last Modified'), value: showValue(row.last_modified) },
					{ name: vscode.l10n.t('MD5'), value: showValue(row.md5) },
				]),
			};
		},
	};
}

/**
 * Creates a stage node. It expands to the stage's files, arranged into folders by their paths (see
 * stageFolders and listStageFolder), and has details: what SHOW STAGES says about it, and its file
 * format and copy options from DESCRIBE STAGE.
 */
function createStageNode(client: SnowflakeClient, database: string, schemaName: string, showRow: Record<string, unknown>): positron.DataConnectionNode {
	const stageName = String(showRow.name);
	const stageRef = objectRef(database, schemaName, stageName);
	// An external stage's URL may come back as a JSON list of one; an internal stage has none.
	const url = showValue(showRow.url);
	const stage: IStageLocation = { path: `@${stageRef}`, url: url === undefined ? undefined : parseJsonList(url)?.[0] ?? url };

	return {
		name: stageName,
		kind: positron.DataConnectionNodeKind.Stage,
		path: stage.path,
		getChildren: () => listStageFolder(client, stage, ''),
		async getDetails() {
			const type = showValue(showRow.type);
			const overview = propertiesSection([
				{ name: vscode.l10n.t('Path'), value: stage.path },
				{ name: vscode.l10n.t('Type'), value: type },
				{ name: vscode.l10n.t('URL'), value: stage.url },
				{ name: vscode.l10n.t('Cloud'), value: showValue(showRow.cloud) },
				{ name: vscode.l10n.t('Region'), value: showValue(showRow.region) },
				{ name: vscode.l10n.t('Storage Integration'), value: showValue(showRow.storage_integration) },
				{ name: vscode.l10n.t('Directory Table'), value: showFlag(showRow.directory_enabled) },
				{ name: vscode.l10n.t('Has Credentials'), value: showFlag(showRow.has_credentials) },
				{ name: vscode.l10n.t('Has Encryption Key'), value: showFlag(showRow.has_encryption_key) },
				{ name: vscode.l10n.t('Owner'), value: showValue(showRow.owner) },
				{ name: vscode.l10n.t('Created'), value: showValue(showRow.created_on) },
				{ name: vscode.l10n.t('Comment'), value: showValue(showRow.comment) },
			]);
			const properties = await settleSections(async () =>
				stagePropertySections((await client.query(`DESCRIBE STAGE ${stageRef}`)).rows));
			return {
				description: type?.toUpperCase() === 'EXTERNAL' ? vscode.l10n.t('External stage') : vscode.l10n.t('Stage'),
				sections: [],
				tabs: [
					{ title: vscode.l10n.t('Overview'), sections: overview },
					{ title: vscode.l10n.t('Properties'), sections: properties },
				],
			};
		},
	};
}

/**
 * Builds the sections of a stage's Properties tab from DESCRIBE STAGE, which returns a row per
 * property with columns `parent_property` (e.g. STAGE_FILE_FORMAT, STAGE_COPY_OPTIONS),
 * `property`, `property_value`, and `property_default`. Each parent property gets a table of its own,
 * in the order DESCRIBE returns them.
 */
function stagePropertySections(rows: Record<string, unknown>[]): positron.DataConnectionNodeDetailsSection[] {
	const byParent = new Map<string, string[][]>();
	for (const row of rows) {
		const parent = showValue(row.parent_property) ?? '';
		let tableRows = byParent.get(parent);
		if (!tableRows) {
			tableRows = [];
			byParent.set(parent, tableRows);
		}
		tableRows.push([showValue(row.property) ?? '', showValue(row.property_value) ?? '', showValue(row.property_default) ?? '']);
	}
	const columns = [vscode.l10n.t('Property'), vscode.l10n.t('Value'), vscode.l10n.t('Default')];
	return [...byParent].map(([parent, tableRows]) => ({
		kind: 'table' as const,
		title: parent ? propertyLabel(parent.replace(/^STAGE_/, '')) : undefined,
		columns,
		rows: tableRows,
	}));
}

/**
 * Creates a table or view node that expands to a single "Columns" group, and has details: what its
 * SHOW row says about it, its columns, and for a view its definition.
 *
 * The Columns group and the details share one DESCRIBE, so clicking the node (as often as the user
 * likes) and expanding its columns cost one between them. Refreshing reloads it: expanding the
 * Columns group always runs a fresh DESCRIBE, and refreshing the node itself (or anything above it)
 * drops the shared one, so the next click fetches it again.
 * @param showRow The object's row from SHOW TABLES or SHOW VIEWS.
 */
function createRelationNode(
	client: SnowflakeClient,
	host: ISnowflakePreviewHost,
	database: string,
	schemaName: string,
	showRow: Record<string, unknown>,
	kind: 'table' | 'view'
): positron.DataConnectionNode {
	const relationName = String(showRow.name);
	const path = objectRef(database, schemaName, relationName);
	// DESCRIBE needs no warehouse and returns columns in ordinal order with a ready-formatted `type`
	// string (e.g. NUMBER(38,0), TIMESTAMP_NTZ(9)), so no type assembly is needed. Use the keyword
	// matching the relation kind.
	let columns: Promise<Record<string, unknown>[]> | undefined;
	const describe = (fresh: boolean) => {
		if (fresh || !columns) {
			const attempt = (async () =>
				(await client.query(`${kind === 'view' ? 'DESCRIBE VIEW' : 'DESCRIBE TABLE'} ${path}`)).rows)();
			columns = attempt;
			// A failed DESCRIBE is forgotten, so the next click retries it.
			attempt.catch(() => {
				if (columns === attempt) {
					columns = undefined;
				}
			});
		}
		return columns;
	};
	return {
		name: relationName,
		kind: kind === 'table' ? positron.DataConnectionNodeKind.Table : positron.DataConnectionNodeKind.View,
		path,
		async getChildren() {
			// The tree calls this on expanding the node and on refreshing it.
			columns = undefined;
			return [createColumnsGroupNode(client, host, database, schemaName, relationName, kind, () => describe(true))];
		},
		preview() {
			return host.previewObject(client, database, schemaName, relationName, kind);
		},
		async getDetails() {
			const loadColumns = () => describe(false);
			return kind === 'table' ? tableDetails(showRow, path, loadColumns) : viewDetails(showRow, path, loadColumns);
		},
	};
}

/**
 * Builds a Columns tab from a table's or view's DESCRIBE rows: each column with its type and comment.
 */
async function columnsTab(describe: () => Promise<Record<string, unknown>[]>): Promise<positron.DataConnectionNodeDetailsTab> {
	return {
		title: vscode.l10n.t('Columns'),
		sections: await settleSections(async () => [{
			kind: 'items',
			items: (await describe()).map(row => ({
				name: String(row.name),
				kind: positron.DataConnectionNodeKind.Field,
				dataType: showValue(row.type),
				description: showValue(row.comment),
			})),
			emptyText: vscode.l10n.t('No columns'),
		}]),
	};
}

/**
 * Builds the details of a table: an Overview of what SHOW TABLES says about it, and its columns.
 * @param showRow The table's row from SHOW TABLES.
 * @param path The table's quoted three-part name.
 * @param describe Loads the table's columns (DESCRIBE TABLE).
 */
async function tableDetails(showRow: Record<string, unknown>, path: string, describe: () => Promise<Record<string, unknown>[]>): Promise<positron.DataConnectionNodeDetails> {
	// SHOW TABLES lists every kind of table; the flags say which special kind this one is, if any.
	const description =
		parseFlag(showRow.is_dynamic) ? vscode.l10n.t('Dynamic table') :
			parseFlag(showRow.is_iceberg) ? vscode.l10n.t('Iceberg table') :
				parseFlag(showRow.is_hybrid) ? vscode.l10n.t('Hybrid table') :
					parseFlag(showRow.is_external) ? vscode.l10n.t('External table') :
						parseFlag(showRow.is_event) ? vscode.l10n.t('Event table') :
							vscode.l10n.t('Table');
	const overview = propertiesSection([
		{ name: vscode.l10n.t('Path'), value: path },
		{ name: vscode.l10n.t('Kind'), value: showValue(showRow.kind) },
		{ name: vscode.l10n.t('Owner'), value: showValue(showRow.owner) },
		{ name: vscode.l10n.t('Created'), value: showValue(showRow.created_on) },
		{ name: vscode.l10n.t('Rows'), value: showCount(showRow.rows) },
		{ name: vscode.l10n.t('Size'), value: showSize(showRow.bytes) },
		{ name: vscode.l10n.t('Clustering Key'), value: showValue(showRow.cluster_by) },
		{ name: vscode.l10n.t('Automatic Clustering'), value: showValue(showRow.cluster_by) ? showFlag(showRow.automatic_clustering) : undefined },
		{ name: vscode.l10n.t('Change Tracking'), value: showFlag(showRow.change_tracking) },
		{ name: vscode.l10n.t('Retention Time (Days)'), value: showValue(showRow.retention_time) },
		{ name: vscode.l10n.t('Comment'), value: showValue(showRow.comment) },
	]);
	return {
		description,
		sections: [],
		tabs: [
			{ title: vscode.l10n.t('Overview'), sections: overview },
			await columnsTab(describe),
		],
	};
}

/**
 * Builds the details of a view: an Overview of what SHOW VIEWS says about it, its columns, and its
 * definition. The definition is SHOW VIEWS' `text` column, so it costs no query of its own (unlike a
 * semantic view's GET_DDL); SHOW leaves it empty for a secure view the role doesn't own.
 * @param showRow The view's row from SHOW VIEWS.
 * @param path The view's quoted three-part name.
 * @param describe Loads the view's columns (DESCRIBE VIEW).
 */
async function viewDetails(showRow: Record<string, unknown>, path: string, describe: () => Promise<Record<string, unknown>[]>): Promise<positron.DataConnectionNodeDetails> {
	const materialized = parseFlag(showRow.is_materialized);
	const overview = propertiesSection([
		{ name: vscode.l10n.t('Path'), value: path },
		{ name: vscode.l10n.t('Owner'), value: showValue(showRow.owner) },
		{ name: vscode.l10n.t('Created'), value: showValue(showRow.created_on) },
		{ name: vscode.l10n.t('Secure'), value: showFlag(showRow.is_secure) },
		{ name: vscode.l10n.t('Materialized'), value: showFlag(showRow.is_materialized) },
		{ name: vscode.l10n.t('Change Tracking'), value: showFlag(showRow.change_tracking) },
		{ name: vscode.l10n.t('Comment'), value: showValue(showRow.comment) },
	]);
	const text = showValue(showRow.text);
	const definition: positron.DataConnectionNodeDetailsSection = text !== undefined && text.trim().length > 0
		? { kind: 'code', languageId: 'sql', code: text }
		: { kind: 'properties', properties: [{ name: vscode.l10n.t('Unavailable'), value: vscode.l10n.t('The definition is not available to the current role.') }] };
	return {
		description: materialized ? vscode.l10n.t('Materialized view') : vscode.l10n.t('View'),
		sections: [],
		tabs: [
			{ title: vscode.l10n.t('Overview'), sections: overview },
			await columnsTab(describe),
			{ title: vscode.l10n.t('Definition'), sections: [definition] },
		],
	};
}

/**
 * Creates the "Columns" group inside a table or view, from the relation's DESCRIBE.
 * Primary-key detection is intentionally skipped: Snowflake does not enforce primary keys and does not
 * expose them for browsing.
 * @param describe Runs the relation's DESCRIBE afresh, sharing the result with its details.
 */
function createColumnsGroupNode(
	client: SnowflakeClient,
	host: ISnowflakePreviewHost,
	database: string,
	schemaName: string,
	relationName: string,
	kind: 'table' | 'view',
	describe: () => Promise<Record<string, unknown>[]>
): positron.DataConnectionNode {
	return {
		name: vscode.l10n.t('Columns'),
		kind: positron.DataConnectionNodeKind.GroupColumns,
		async getChildren() {
			return (await describe()).map(row => ({
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
