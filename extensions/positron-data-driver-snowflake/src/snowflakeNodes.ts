/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Schema-tree node builders for a Snowflake connection. A Snowflake connection can see every database
// the active role can access, so the tree is always cross-database: the root is a "Databases" group,
// and everything under it is enumerated with SHOW/DESCRIBE metadata commands.
//
// Browsing deliberately uses SHOW (SHOW TERSE DATABASES / SCHEMAS / TABLES / VIEWS, SHOW SEMANTIC
// VIEWS, SHOW STAGES) and DESCRIBE rather than SELECTs against INFORMATION_SCHEMA. INFORMATION_SCHEMA views require an active
// warehouse (compute), so querying them fails with "No active warehouse selected in the current
// session" whenever the connection has no warehouse -- and warehouse is an optional connection field.
// SHOW/DESCRIBE run on the cloud-services layer and need no warehouse, so the tree expands regardless.
// (Previewing data in the Data Explorer still needs a warehouse, since that runs a real SELECT.) Each
// command is scoped by fully-qualified object name, so it works no matter which database or schema the
// session currently has selected. Snowflake does not enforce primary keys, so no primary-key detection
// is attempted and field nodes are never marked as primary keys.

import * as positron from 'positron';
import { SnowflakeClient } from './snowflakeClient.js';

/** Quotes and escapes an identifier for Snowflake by doubling embedded double-quotes. */
function quoteIdentifier(name: string): string {
	return '"' + name.replace(/"/g, '""') + '"';
}

/** Builds a double-quoted two-part `"<db>"."<schema>"` reference. */
function schemaRef(database: string, schemaName: string): string {
	return `${quoteIdentifier(database)}.${quoteIdentifier(schemaName)}`;
}

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
 * Uses SHOW TERSE DATABASES so no current-database context is required.
 */
export function createDatabasesGroupNode(client: SnowflakeClient, host: ISnowflakePreviewHost): positron.DataConnectionNode {
	return {
		name: 'Databases',
		kind: positron.DataConnectionNodeKind.GroupDatabases,
		async getChildren() {
			// SHOW returns a row per database with a lowercase `name` column.
			const result = await client.query('SHOW TERSE DATABASES');
			return result.rows
				.map(row => String(row.name))
				.sort((a, b) => a.localeCompare(b))
				.map(name => createDatabaseNode(client, host, name));
		},
	};
}

/**
 * Creates a database node that expands to a single "Schemas" group. Exported so unit tests can
 * construct a database node directly against a mocked client.
 */
export function createDatabaseNode(client: SnowflakeClient, host: ISnowflakePreviewHost, database: string): positron.DataConnectionNode {
	return {
		name: database,
		kind: positron.DataConnectionNodeKind.Database,
		async getChildren() {
			return [createSchemasGroupNode(client, host, database)];
		},
	};
}

/** Creates the "Schemas" group inside a database node, via `SHOW TERSE SCHEMAS`. */
export function createSchemasGroupNode(client: SnowflakeClient, host: ISnowflakePreviewHost, database: string): positron.DataConnectionNode {
	return {
		name: 'Schemas',
		kind: positron.DataConnectionNodeKind.GroupSchemas,
		async getChildren() {
			// SHOW runs without a warehouse; SHOW returns a lowercase `name` column. Every schema is
			// listed, including INFORMATION_SCHEMA -- it is a browsable schema, not noise to hide.
			const result = await client.query(`SHOW TERSE SCHEMAS IN DATABASE ${quoteIdentifier(database)}`);
			return result.rows
				.map(row => String(row.name))
				.sort((a, b) => a.localeCompare(b))
				.map(name => createSchemaNode(client, host, database, name));
		},
	};
}

/**
 * Creates a schema node that expands to Tables and Views groups. Exported so unit tests can construct
 * a schema node directly against a mocked client.
 */
export function createSchemaNode(client: SnowflakeClient, host: ISnowflakePreviewHost, database: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: schemaName,
		kind: positron.DataConnectionNodeKind.Schema,
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

/** Creates the "Tables" group inside a schema. Lists base tables via `SHOW TERSE TABLES`. */
function createTablesGroupNode(client: SnowflakeClient, host: ISnowflakePreviewHost, database: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: 'Tables',
		kind: positron.DataConnectionNodeKind.GroupTables,
		async getChildren() {
			// SHOW TABLES lists only base tables (views come from SHOW VIEWS) and needs no warehouse.
			const result = await client.query(`SHOW TERSE TABLES IN SCHEMA ${schemaRef(database, schemaName)}`);
			return result.rows
				.map(row => String(row.name))
				.sort((a, b) => a.localeCompare(b))
				.map(name => createRelationNode(client, host, database, schemaName, name, 'table'));
		},
	};
}

/** Creates the "Views" group inside a schema. Lists views via `SHOW TERSE VIEWS`. */
function createViewsGroupNode(client: SnowflakeClient, host: ISnowflakePreviewHost, database: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: 'Views',
		kind: positron.DataConnectionNodeKind.GroupViews,
		async getChildren() {
			const result = await client.query(`SHOW TERSE VIEWS IN SCHEMA ${schemaRef(database, schemaName)}`);
			return result.rows
				.map(row => String(row.name))
				.sort((a, b) => a.localeCompare(b))
				.map(name => createRelationNode(client, host, database, schemaName, name, 'view'));
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
		name: 'Semantic Views',
		kind: positron.DataConnectionNodeKind.GroupSemanticViews,
		async getChildren() {
			const result = await client.query(`SHOW SEMANTIC VIEWS IN SCHEMA ${schemaRef(database, schemaName)}`);
			return result.rows
				.map(row => String(row.name))
				.sort((a, b) => a.localeCompare(b))
				.map(name => createSemanticViewNode(client, host, database, schemaName, name));
		},
	};
}

/** A member of a semantic view (logical table, relationship, fact, dimension, or metric). */
interface ISemanticViewMember {
	/** The member's name. */
	name: string;
	/** The logical table the member belongs to; unset for logical tables and view-level members. */
	table?: string;
	/** The member's properties (e.g. DATA_TYPE, EXPRESSION), keyed by property name. */
	properties: Map<string, string>;
}

/** The members of a semantic view, bucketed by kind in definition order. */
interface ISemanticViewMembers {
	tables: ISemanticViewMember[];
	relationships: ISemanticViewMember[];
	facts: ISemanticViewMember[];
	dimensions: ISemanticViewMember[];
	metrics: ISemanticViewMember[];
}

/**
 * Parses the rows of `DESCRIBE SEMANTIC VIEW` into members. DESCRIBE returns one row per property,
 * with columns `object_kind`, `object_name`, `parent_entity`, `property`, and `property_value`, so a
 * member's rows are collapsed into one entry. Rows with no object kind describe the semantic view
 * itself (e.g. its comment) and are skipped. Exported for unit tests.
 */
export function parseSemanticViewDescription(rows: Record<string, unknown>[]): ISemanticViewMembers {
	const members: ISemanticViewMembers = { tables: [], relationships: [], facts: [], dimensions: [], metrics: [] };
	const byKey = new Map<string, ISemanticViewMember>();
	for (const row of rows) {
		const objectKind = row.object_kind ? String(row.object_kind) : '';
		let bucket: ISemanticViewMember[];
		switch (objectKind) {
			case 'TABLE': bucket = members.tables; break;
			case 'RELATIONSHIP': bucket = members.relationships; break;
			case 'FACT': bucket = members.facts; break;
			case 'DIMENSION': bucket = members.dimensions; break;
			// Derived metrics are defined at the view level, over other metrics, rather than on a table.
			case 'METRIC':
			case 'DERIVED_METRIC': bucket = members.metrics; break;
			default: continue;
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
	return members;
}

/**
 * Creates a semantic view node. Expanding it runs a single `DESCRIBE SEMANTIC VIEW` and returns a
 * group per member kind (Tables, Relationships, Facts, Dimensions, Metrics); the groups are built
 * from that one result, so expanding them costs no further round-trips. Kinds the semantic view does
 * not define are omitted rather than shown as empty groups.
 *
 * A logical table is only a name inside the semantic view and cannot be queried itself, but it
 * aliases exactly one base table or view, so previewing it opens that base object. The node shows
 * the base object's three-part name, so it is clear the preview is the raw base data rather than the
 * semantic view's model of it.
 */
function createSemanticViewNode(client: SnowflakeClient, host: ISnowflakePreviewHost, database: string, schemaName: string, semanticViewName: string): positron.DataConnectionNode {
	return {
		name: semanticViewName,
		kind: positron.DataConnectionNodeKind.SemanticView,
		async getChildren() {
			const semanticViewRef = `${schemaRef(database, schemaName)}.${quoteIdentifier(semanticViewName)}`;
			const result = await client.query(`DESCRIBE SEMANTIC VIEW ${semanticViewRef}`);
			const members = parseSemanticViewDescription(result.rows);
			const K = positron.DataConnectionNodeKind;
			return [
				createSemanticViewMemberGroupNode('Tables', K.GroupLogicalTables, members.tables, member => createLogicalTableNode(client, host, member)),
				createSemanticViewMemberGroupNode('Relationships', K.GroupRelationships, members.relationships, member => ({ name: member.name, kind: K.Relationship })),
				createSemanticViewMemberGroupNode('Facts', K.GroupFacts, members.facts, member => createSemanticExpressionNode(member, K.Fact)),
				createSemanticViewMemberGroupNode('Dimensions', K.GroupDimensions, members.dimensions, member => createSemanticExpressionNode(member, K.Dimension)),
				createSemanticViewMemberGroupNode('Metrics', K.GroupMetrics, members.metrics, member => createSemanticExpressionNode(member, K.Metric)),
			].filter((group): group is positron.DataConnectionNode => group !== undefined);
		},
	};
}

/** Creates a group of semantic view members, or undefined when there are none. */
function createSemanticViewMemberGroupNode(
	name: string,
	kind: positron.DataConnectionNodeKind,
	members: ISemanticViewMember[],
	createMemberNode: (member: ISemanticViewMember) => positron.DataConnectionNode
): positron.DataConnectionNode | undefined {
	if (members.length === 0) {
		return undefined;
	}
	return {
		name,
		kind,
		async getChildren() {
			return members.map(createMemberNode);
		},
	};
}

/**
 * Creates a logical table node. When DESCRIBE reported the base object, the node previews it and
 * shows its three-part name; otherwise it is a plain leaf.
 */
function createLogicalTableNode(client: SnowflakeClient, host: ISnowflakePreviewHost, member: ISemanticViewMember): positron.DataConnectionNode {
	const baseDatabase = member.properties.get('BASE_TABLE_DATABASE_NAME');
	const baseSchema = member.properties.get('BASE_TABLE_SCHEMA_NAME');
	const baseTable = member.properties.get('BASE_TABLE_NAME');
	if (!baseDatabase || !baseSchema || !baseTable) {
		return { name: member.name, kind: positron.DataConnectionNodeKind.LogicalTable };
	}
	return {
		name: member.name,
		kind: positron.DataConnectionNodeKind.LogicalTable,
		dataType: `${baseDatabase}.${baseSchema}.${baseTable}`,
		preview() {
			// The base object may be a table or a view; DESCRIBE does not say which. The kind only tags
			// the dataset id -- the Snowflake preview queries both the same way -- so 'table' is safe.
			return host.previewObject(client, baseDatabase, baseSchema, baseTable, 'table');
		},
	};
}

/**
 * Creates a fact, dimension, or metric node. These are scoped to a logical table, so they are named
 * `<table>.<name>`, which is also how a SEMANTIC_VIEW(...) query refers to them, and carry their
 * DATA_TYPE.
 */
function createSemanticExpressionNode(member: ISemanticViewMember, kind: positron.DataConnectionNodeKind): positron.DataConnectionNode {
	return {
		name: member.table ? `${member.table}.${member.name}` : member.name,
		kind,
		dataType: member.properties.get('DATA_TYPE'),
	};
}

/**
 * Creates the "Stages" group inside a schema. Lists named stages via `SHOW STAGES`. Stages hold files
 * rather than tabular rows, so stage nodes are leaves: no Data Explorer preview and no children
 * (listing a stage's files is deliberately left for a follow-up). Takes no preview host for that
 * reason.
 */
function createStagesGroupNode(client: SnowflakeClient, database: string, schemaName: string): positron.DataConnectionNode {
	return {
		name: 'Stages',
		kind: positron.DataConnectionNodeKind.GroupStages,
		async getChildren() {
			const result = await client.query(`SHOW STAGES IN SCHEMA ${schemaRef(database, schemaName)}`);
			return result.rows
				.map(row => String(row.name))
				.sort((a, b) => a.localeCompare(b))
				.map(name => ({
					name,
					kind: positron.DataConnectionNodeKind.Stage,
				}));
		},
	};
}

/** Creates a table or view node that expands to a single "Columns" group. */
function createRelationNode(
	client: SnowflakeClient,
	host: ISnowflakePreviewHost,
	database: string,
	schemaName: string,
	relationName: string,
	kind: 'table' | 'view'
): positron.DataConnectionNode {
	return {
		name: relationName,
		kind: kind === 'table' ? positron.DataConnectionNodeKind.Table : positron.DataConnectionNodeKind.View,
		async getChildren() {
			return [createColumnsGroupNode(client, host, database, schemaName, relationName, kind)];
		},
		preview() {
			return host.previewObject(client, database, schemaName, relationName, kind);
		},
	};
}

/**
 * Creates the "Columns" group inside a table or view. Columns come from DESCRIBE TABLE/VIEW.
 * Primary-key detection is intentionally skipped: Snowflake does not enforce primary keys and does not
 * expose them for browsing.
 */
function createColumnsGroupNode(
	client: SnowflakeClient,
	host: ISnowflakePreviewHost,
	database: string,
	schemaName: string,
	relationName: string,
	kind: 'table' | 'view'
): positron.DataConnectionNode {
	return {
		name: 'Columns',
		kind: positron.DataConnectionNodeKind.GroupColumns,
		async getChildren() {
			// DESCRIBE needs no warehouse and returns columns in ordinal order with a ready-formatted
			// `type` string (e.g. NUMBER(38,0), TIMESTAMP_NTZ(9)), so no type assembly is needed. Use the
			// keyword matching the relation kind.
			const relationRef = `${schemaRef(database, schemaName)}.${quoteIdentifier(relationName)}`;
			const command = kind === 'view' ? 'DESCRIBE VIEW' : 'DESCRIBE TABLE';
			const result = await client.query(`${command} ${relationRef}`);
			return result.rows.map(row => ({
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
