/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { supportsSql } from './dialects';
import { SqlLog } from './log';

/**
 * Reads the tables and columns of the user's live data connections, for the editor features to
 * complete and check against.
 *
 * The metadata comes from Positron's Data Connections through the `positron.dataConnections` API:
 * `getConnections` for what the user has, `getSchema` for what each live one exposes. The schema
 * is read in one bounded call per connection rather than by walking the tree, because a walk
 * costs a round trip to the engine per node and a warehouse has thousands of them.
 */

/** The setting that turns the Data Connections feature off entirely. */
const DATA_CONNECTIONS_ENABLED = 'dataConnections.enabled';

/**
 * Bounds for each connection's schema read.
 *
 * The API's own defaults (depth 4, 50 per level, 500 total) are sized for handing a summary to a
 * language model. Completion wants more of the schema than that -- a list missing most of a
 * database's tables reads as the feature being broken -- so this raises the widths and leaves the
 * depth alone. Four levels is already catalog, schema, table, column, which is as deep as
 * anything completed here lives.
 */
const SCHEMA_BOUNDS = {
	maxDepth: 4,
	maxNodesPerLevel: 200,
	maxTotalNodes: 5000,
};

/** Node kinds that name a namespace above a table. */
const CATALOG_KINDS = new Set(['catalog', 'database']);
const SCHEMA_KINDS = new Set(['schema']);

/** Node kinds that hold columns. */
const TABLE_KINDS = new Set(['table', 'view']);

/** The node kind of a column. */
const FIELD_KIND = 'field';

/**
 * The part of `positron.dataConnections` this module uses.
 *
 * Injected so the empty-schema paths -- which is all a user without a connection ever sees -- can
 * be tested without a live database behind them.
 */
export interface DataConnectionsApi {
	getConnections(): Thenable<positron.DataConnectionSummary[]>;
	getSchema(
		profileId: string,
		options?: positron.DataConnectionSchemaOptions,
	): Thenable<positron.DataConnectionSchema | undefined>;
}

/** A column, in the form the `sql/setSchema` notification carries. */
export interface SqlColumn {
	readonly name: string;
	readonly dataType?: string;
	readonly isPrimaryKey?: boolean;
}

/** A table or view, in the form the `sql/setSchema` notification carries. */
export interface SqlTable {
	readonly name: string;
	readonly schema?: string;
	readonly catalog?: string;
	readonly kind: string;
	readonly connection?: string;

	/** The profile the table came from, so a document link can name the tree to reveal it in. */
	readonly profileId?: string;

	readonly columns: SqlColumn[];
}

/** A connection the tables were read from, by id and by the name the user gave it. */
export interface ConnectionRef {
	readonly profileId: string;
	readonly name: string;

	/** The driver it was made with, which is what says how to read SQL written against it. */
	readonly driverId: string;
}

/** Everything the editor features know about the user's databases. */
export interface SqlSchema {
	readonly tables: SqlTable[];

	/**
	 * The open connections the tables were read from, including any that had none.
	 *
	 * Carried with the tables so that the connection picker and the status bar name exactly the
	 * set the completions were drawn from, rather than reading the connections a second time and
	 * showing a list that disagrees with what a file actually completes against.
	 */
	readonly connections: readonly ConnectionRef[];

	/**
	 * The connections whose schema is not a full picture: cut short by the node caps, or not
	 * readable at all.
	 *
	 * Per connection rather than one flag for the lot, because a document scoped to one connection
	 * must not inherit another's holes -- a name would go unjudged, or be judged against a schema
	 * that was never fully read.
	 *
	 * Needed to know a name cannot be judged unknown: a table missing from a schema that was cut
	 * short was far more likely dropped by a cap than misspelled by the user.
	 */
	readonly incompleteProfiles: readonly string[];
}

/** What a user with nothing connected has, and what every failed read falls back to. */
export const EMPTY_SCHEMA: SqlSchema = { tables: [], connections: [], incompleteProfiles: [] };

/**
 * The part of a schema that came from one connection.
 *
 * What a SQL file scoped to that connection completes and is checked against: the other
 * connections' tables are not in the database the file is written for, and their holes are not
 * holes in it either.
 */
export function schemaOfProfile(schema: SqlSchema, profileId: string): SqlSchema {
	return {
		tables: schema.tables.filter(table => table.profileId === profileId),
		connections: schema.connections.filter(connection => connection.profileId === profileId),
		incompleteProfiles: schema.incompleteProfiles.filter(id => id === profileId),
	};
}

/**
 * Flattens one connection's schema tree into the tables completion draws on.
 *
 * The tree is walked rather than indexed by depth: a driver may report tables directly at the
 * root (SQLite), under a schema (PostgreSQL), or under a catalog and a schema (Unity Catalog,
 * Snowflake), and the namespace a table ends up with is whichever of those it was found under.
 * Kinds that hold files rather than rows -- volumes, stages, pins -- are not tables and are
 * skipped along with everything under them.
 *
 * Exported for testing: this is the part of reading a connection that has interesting behavior,
 * and it is a pure function of a payload.
 *
 * @param nodes The root nodes of the connection's schema summary.
 * @param connection The connection's display name, recorded on each table.
 * @param profileId The connection's profile id, recorded on each table.
 */
export function flattenSchemaNodes(
	nodes: readonly positron.DataConnectionSchemaNode[],
	connection?: string,
	profileId?: string,
): SqlTable[] {
	const tables: SqlTable[] = [];

	const walk = (node: positron.DataConnectionSchemaNode, catalog: string | undefined, schema: string | undefined): void => {
		if (TABLE_KINDS.has(node.kind)) {
			tables.push({
				name: node.name,
				catalog,
				schema,
				kind: node.kind,
				connection,
				profileId,
				columns: (node.children ?? [])
					.filter(child => child.kind === FIELD_KIND)
					.map(child => ({
						name: child.name,
						dataType: child.dataType,
						isPrimaryKey: child.isPrimaryKey,
					})),
			});
			return;
		}

		if (CATALOG_KINDS.has(node.kind)) {
			for (const child of node.children ?? []) {
				walk(child, node.name, schema);
			}
			return;
		}

		if (SCHEMA_KINDS.has(node.kind)) {
			for (const child of node.children ?? []) {
				walk(child, catalog, node.name);
			}
		}

		// Any other kind -- a volume, a stage, a pin, an index -- holds nothing that can appear in
		// a SQL statement's FROM clause, so neither it nor its children are collected.
	};

	for (const node of nodes) {
		walk(node, undefined, undefined);
	}

	return tables;
}

/**
 * Explains an empty result, at a level the user can actually see.
 *
 * `getConnections` answers `[]` both when the Data Connections feature is switched off and when
 * the user simply has nothing configured, and the two call for completely different things from
 * the user. The setting is a plain one that any extension can read, so it is consulted here
 * rather than being something the API has to carry -- a tri-state every caller would have to
 * handle, for a case most of them do not care about.
 *
 * Pure, and exported, because the message is the whole behaviour: which of these a user is
 * looking at decides whether they should change a setting, open a connection, or stop expecting
 * completions at all.
 *
 * @param enabled Whether the Data Connections feature is on.
 * @param configuredCount How many connections getConnections reported, live or not.
 */
export function explainEmptySchema(
	enabled: boolean,
	configuredCount: number,
	nonSqlCount = 0,
): string {
	if (!enabled) {
		return 'Table and column completions are off because the Data Connections feature is.'
			+ ' Set "dataConnections.enabled": true and reload the window to turn it on.';
	}

	if (nonSqlCount > 0) {
		// Open, and in the Connections pane where the user can see it, which makes "none are open"
		// read as a bug in the extension rather than as the answer.
		return `The ${nonSqlCount} open data connection(s) are not SQL databases, so completions`
			+ ' cover SQL keywords only. A Posit Connect pin holds a stored R or Python object'
			+ ' rather than tables, and cannot be selected from.';
	}

	if (configuredCount === 0) {
		return 'No data connections are configured, so completions cover SQL keywords only.'
			+ ' Note that a connection opened from R or Python code, which appears in the Connections'
			+ ' pane, is not a data connection and is not a source of completions.';
	}

	return `None of the ${configuredCount} configured data connections are open, so completions`
		+ ' cover SQL keywords only. Connect one and run "SQL: Refresh Database Schema".';
}

/**
 * Reads every live data connection and returns their tables and columns.
 *
 * Each connection is asked for by id rather than letting Positron pick: a SQL file may well be
 * written against any of them, and with more than one live there is nothing to pick on. A
 * connection that fails is logged and left out, so one unreachable database does not cost the
 * completions from the others.
 *
 * @param log Where to report what was read, and anything that went wrong.
 * @param api The data connections API; overridden in tests.
 */
export async function readConnectionSchema(
	log: SqlLog,
	api: DataConnectionsApi = positron.dataConnections,
): Promise<SqlSchema> {
	let connections: positron.DataConnectionSummary[];
	try {
		connections = await api.getConnections();
	} catch (error) {
		// Not an error condition for a SQL file, which still gets keywords and diagnostics.
		log.info(`Data connections are unavailable, so completions cover SQL keywords only: ${error}`);
		return EMPTY_SCHEMA;
	}

	const open = connections.filter(connection => connection.connected);

	// Which connections were considered and which were passed over. At debug, not info: a schema
	// read happens when the user connects or disconnects rather than as they type, but naming
	// every profile on every read would still crowd out the headline below.
	const closed = connections.filter(connection => !connection.connected);
	if (closed.length > 0) {
		log.debug(`Skipped ${closed.length} data connection(s) that are not open: ${names(closed)}.`);
	}

	// A connection to something that is not a SQL database has no tables to offer and cannot be
	// written against, so it is left out of the schema and out of the picker with it.
	const nonSql = open.filter(connection => !supportsSql(connection.driverId));
	if (nonSql.length > 0) {
		log.debug(`Skipped ${nonSql.length} open data connection(s) that are not SQL databases:`
			+ ` ${names(nonSql)}.`);
	}
	const live = open.filter(connection => supportsSql(connection.driverId));

	if (live.length === 0) {
		const enabled = vscode.workspace.getConfiguration().get<boolean>(DATA_CONNECTIONS_ENABLED) !== false;
		log.info(explainEmptySchema(enabled, connections.length, nonSql.length));
		return EMPTY_SCHEMA;
	}

	log.debug(`Reading the schema of ${live.length} live data connection(s): ${names(live)}.`);

	const tables: SqlTable[] = [];
	const read: ConnectionRef[] = [];
	const incompleteProfiles: string[] = [];
	for (const connection of live) {
		const started = Date.now();
		try {
			const schema = await api.getSchema(connection.profileId, SCHEMA_BOUNDS);
			if (!schema) {
				// Disconnected between the two calls, which a user can do at any moment.
				log.info(`No schema for ${connection.name}: it is no longer connected.`);
				continue;
			}
			if (schema.truncated) {
				incompleteProfiles.push(connection.profileId);
				log.info(`The schema of ${connection.name} is larger than the completion limit;`
					+ ' some tables or columns will be missing from completions, and names will not'
					+ ' be reported as unknown.');
			}
			const found = flattenSchemaNodes(schema.nodes, connection.name, connection.profileId);
			log.debug(`${connection.name} (${connection.driverName}): ${describeTables(found)}`
				+ ` in ${Date.now() - started}ms.`);
			tables.push(...found);
			read.push(refOf(connection));
		} catch (error) {
			// A connection that could not be read is a hole in the schema, same as one cut short by
			// the caps, and a name that lives in the hole must not be reported as unknown. It is
			// still listed as open: a file can be scoped to it, and it will fill in when it reads.
			incompleteProfiles.push(connection.profileId);
			read.push(refOf(connection));
			log.warn(`Could not read the schema of ${connection.name}: ${error}`);
		}
	}

	// At info, not debug: this is the line that answers "why am I not getting table completions",
	// and it has to be readable without the user first raising the log level.
	log.info(`Read ${tables.length} table(s) from ${live.length} live data connection(s).`);
	return { tables, connections: read, incompleteProfiles };
}

/** How a connection is carried once the schema has been read from it. */
function refOf(connection: positron.DataConnectionSummary): ConnectionRef {
	return {
		profileId: connection.profileId,
		name: connection.name,
		driverId: connection.driverId,
	};
}

/** The connections named, for a log line that says which ones a count refers to. */
function names(connections: readonly positron.DataConnectionSummary[]): string {
	return connections.map(connection => connection.name).join(', ');
}

/**
 * What one connection contributed.
 *
 * Tables with no columns are called out separately because they are invisible in the totals and
 * are the usual reason a qualifier that resolves offers nothing after the dot: the connection
 * reported the table but the node caps cut the read off above its fields.
 */
function describeTables(tables: readonly SqlTable[]): string {
	const columns = tables.reduce((total, table) => total + table.columns.length, 0);
	const empty = tables.filter(table => table.columns.length === 0).length;
	return `${tables.length} table(s), ${columns} column(s)`
		+ (empty > 0 ? `, ${empty} of them with no columns` : '');
}
