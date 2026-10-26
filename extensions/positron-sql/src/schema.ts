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
const CATALOG_KINDS = new Set<positron.DataConnectionNodeKind>([
	positron.DataConnectionNodeKind.Catalog,
	positron.DataConnectionNodeKind.Database,
]);
const SCHEMA_KINDS = new Set<positron.DataConnectionNodeKind>([positron.DataConnectionNodeKind.Schema]);

/** Node kinds that hold columns. */
const TABLE_KINDS = new Set<positron.DataConnectionNodeKind>([
	positron.DataConnectionNodeKind.Table,
	positron.DataConnectionNodeKind.View,
]);

/** The node kind of a column. */
const FIELD_KIND = positron.DataConnectionNodeKind.Field;

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
		token?: vscode.CancellationToken,
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

	/**
	 * Whether {@link columns} is every column the table has. False when the schema read's caps cut
	 * the list short; left out when nothing says either way, which counts as complete only if the
	 * connection's read was.
	 */
	readonly columnsComplete?: boolean;
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
	 * Every SQL data connection the user has set up, open or not, which is what the connection
	 * picker offers. Choosing one that is closed opens it, so a connection just added in the Data
	 * Connections pane can be picked without opening it there first.
	 */
	readonly configured: readonly ConnectionRef[];

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

	/**
	 * Set when the user has switched Data Connections off. Then there is nothing to set up or
	 * choose, and the status bar and picker say so instead of asking for a connection.
	 */
	readonly dataConnectionsOff?: boolean;
}

/** What a user with nothing connected has, and what every failed read falls back to. */
export const EMPTY_SCHEMA: SqlSchema = { tables: [], connections: [], configured: [], incompleteProfiles: [] };

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
		configured: schema.configured.filter(connection => connection.profileId === profileId),
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
				// A count of children left out is all the read says about what it missed. It
				// counts every kind of child, an index as well as a column, so a table missing
				// only an index is called short too -- the side that costs a missed warning
				// rather than a false one.
				columnsComplete: node.truncatedChildCount === undefined,
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
 * Only for a feature that is on: `getConnections` rejects when the user has switched Data
 * Connections off, and that is reported where the rejection is caught.
 *
 * Pure, and exported, because the message is the whole behaviour: which of these a user is
 * looking at decides whether they should open a connection or stop expecting completions at all.
 *
 * @param configuredCount How many connections getConnections reported, live or not.
 * @param nonSqlCount How many of the open ones are not SQL databases.
 */
export function explainEmptySchema(
	configuredCount: number,
	nonSqlCount = 0,
): string {
	if (nonSqlCount > 0) {
		// Open, and in the Data Connections pane where the user can see it, which makes "none are open"
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
 * Reads every live data connection and returns their tables and columns, in one go.
 *
 * @param log Where to report what was read, and anything that went wrong.
 * @param api The data connections API; overridden in tests.
 * @param timeoutMs How long one connection's read may take; shortened in tests.
 */
export function readConnectionSchema(
	log: SqlLog,
	api: DataConnectionsApi = positron.dataConnections,
	timeoutMs = SCHEMA_READ_TIMEOUT_MS,
): Promise<SqlSchema> {
	return new SchemaReader(log, api, timeoutMs).read();
}

/**
 * How long one connection's schema read may take before it is given up on.
 *
 * Generous, because a warehouse that has to resume before it answers can take most of this, and
 * a read given up on costs that connection's completions until the schema is next read. Bounded,
 * because the reads are awaited together and a connection that never answers would otherwise
 * leave every file without tables.
 */
const SCHEMA_READ_TIMEOUT_MS = 30_000;

/** What reading one connection came to. */
type ReadOutcome =
	| { readonly tables: SqlTable[]; readonly truncated: boolean }
	| 'disconnected'
	| 'failed';

/**
 * Reads the tables and columns of the user's live data connections, again each time they change,
 * walking a connection only when there is something new to find in it.
 *
 * Each connection is asked for by id rather than letting Positron pick: a SQL file may well be
 * written against any of them, and with more than one live there is nothing to pick on. A
 * connection that fails, or takes longer than the deadline, is logged and left out, so one
 * unreachable database does not cost the completions from the others.
 *
 * A walk costs a round trip to the database per node with children, up to thousands of them, and
 * a read is asked for whenever any connection opens or closes and any profile is added, renamed or
 * removed. So a connection that stayed open keeps the schema it was last read with, and only one
 * that has just opened -- or could not be read last time -- is walked.
 */
export class SchemaReader implements vscode.Disposable {

	/**
	 * Each open connection's schema as last read, by profile. Kept as read rather than flattened,
	 * so a connection the user renames is named by its new name without being walked again.
	 */
	private readonly _schemas = new Map<string, positron.DataConnectionSchema>();

	/**
	 * Walks in flight, by profile, and how many reads are waiting on each.
	 *
	 * A read asked for while a connection is being walked waits on that walk rather than starting
	 * a second one beside it. A walk every read has given up on is cancelled, since it would
	 * otherwise go on querying the database for an answer nobody takes.
	 */
	private readonly _walks = new Map<string, Walk>();

	/**
	 * @param _log Where to report what was read, and anything that went wrong.
	 * @param _api The data connections API; overridden in tests.
	 * @param _timeoutMs How long one connection's read may take; shortened in tests.
	 * @param _isEnabled Whether the user has Data Connections switched on.
	 */
	constructor(
		private readonly _log: SqlLog,
		private readonly _api: DataConnectionsApi = positron.dataConnections,
		private readonly _timeoutMs = SCHEMA_READ_TIMEOUT_MS,
		private readonly _isEnabled: () => boolean = () => true,
	) { }

	/**
	 * Reads what is open now.
	 *
	 * @param fresh Walk every open connection again, rather than only those not read yet. For the
	 *   user asking: a database's tables can change without the connection to it closing.
	 */
	public async read(fresh = false): Promise<SqlSchema> {
		if (!this._isEnabled()) {
			// Not asked: the API would reject, and the answer is already known.
			this._schemas.clear();
			this._log.info('Data Connections is turned off, so completions cover SQL keywords only.'
				+ ' Turn on the dataConnections.enabled setting to complete against a database.');
			return { ...EMPTY_SCHEMA, dataConnectionsOff: true };
		}

		let connections: positron.DataConnectionSummary[];
		try {
			connections = await this._api.getConnections();
		} catch (error) {
			// Not an error condition for a SQL file, which still gets keywords and diagnostics. This
			// is also where a Data Connections feature the user switched off ends up: the API
			// rejects rather than answering with no connections, and its error names the setting.
			this._log.info(`Data connections are unavailable, so completions cover SQL keywords only: ${error}`);
			return EMPTY_SCHEMA;
		}

		const open = connections.filter(connection => connection.connected);
		const configured = connections.filter(connection => supportsSql(connection.driverId)).map(refOf);

		// Which connections were considered and which were passed over. At debug, not info: a schema
		// read happens when the user connects or disconnects rather than as they type, but naming
		// every profile on every read would still crowd out the headline below.
		const closed = connections.filter(connection => !connection.connected);
		if (closed.length > 0) {
			this._log.debug(`Skipped ${closed.length} data connection(s) that are not open: ${names(closed)}.`);
		}

		// A connection to something that is not a SQL database has no tables to offer and cannot be
		// written against, so it is left out of the schema and out of the picker with it.
		const nonSql = open.filter(connection => !supportsSql(connection.driverId));
		if (nonSql.length > 0) {
			this._log.debug(`Skipped ${nonSql.length} open data connection(s) that are not SQL databases:`
				+ ` ${names(nonSql)}.`);
		}
		const live = open.filter(connection => supportsSql(connection.driverId));

		// A connection that closed is walked again when it reopens: what is in it may have changed
		// in between.
		const liveIds = new Set(live.map(connection => connection.profileId));
		for (const profileId of [...this._schemas.keys()]) {
			if (!liveIds.has(profileId)) {
				this._schemas.delete(profileId);
			}
		}

		if (live.length === 0) {
			this._log.info(explainEmptySchema(connections.length, nonSql.length));
			return { ...EMPTY_SCHEMA, configured };
		}

		const kept = fresh ? [] : live.filter(connection => this._schemas.has(connection.profileId));
		const walked = live.filter(connection => !kept.includes(connection));
		if (walked.length > 0) {
			this._log.debug(`Reading the schema of ${walked.length} live data connection(s): ${names(walked)}.`);
		}
		if (kept.length > 0) {
			this._log.debug(`Keeping the schema already read from ${kept.length} data connection(s): ${names(kept)}.`);
		}

		// Read side by side, and each one given a deadline: one warehouse still resuming, or a host
		// that never answers, must not hold up the tables of every other connection -- nor leave the
		// file scoped to a healthy one with nothing at all.
		const outcomes = await Promise.all(live.map(connection => {
			const schema = kept.includes(connection) ? this._schemas.get(connection.profileId) : undefined;
			return schema ? outcomeOf(connection, schema) : this._readOne(connection);
		}));

		const tables: SqlTable[] = [];
		const read: ConnectionRef[] = [];
		const incompleteProfiles: string[] = [];
		live.forEach((connection, index) => {
			const outcome = outcomes[index];
			if (outcome === 'disconnected') {
				return;
			}
			read.push(refOf(connection));
			if (outcome === 'failed') {
				// A connection that could not be read is a hole in the schema, same as one cut short
				// by the caps, and a name that lives in the hole must not be reported as unknown. It
				// is still listed as open: a file can be scoped to it, and it will fill in when it
				// reads.
				incompleteProfiles.push(connection.profileId);
				return;
			}
			if (outcome.truncated) {
				incompleteProfiles.push(connection.profileId);
			}
			tables.push(...outcome.tables);
		});

		// At info, not debug: this is the line that answers "why am I not getting table completions",
		// and it has to be readable without the user first raising the log level.
		this._log.info(`Read ${tables.length} table(s) from ${live.length} live data connection(s).`);
		return { tables, connections: read, configured, incompleteProfiles };
	}

	/** Reads one connection's schema, within a deadline, logging how it went. */
	private async _readOne(connection: positron.DataConnectionSummary): Promise<ReadOutcome> {
		const started = Date.now();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const deadline = new Promise<'timeout'>(resolve => {
			timer = setTimeout(() => resolve('timeout'), this._timeoutMs);
		});
		try {
			// A late answer, or the rejection of a walk cancelled below, is dropped by the race.
			const walk = this._join(connection.profileId);
			const schema = await Promise.race([walk.schema, deadline]);
			if (schema === 'timeout') {
				this._leave(connection.profileId, walk);
				this._log.warn(`Gave up reading the schema of ${connection.name} after`
					+ ` ${this._timeoutMs / 1000}s; run "SQL: Refresh Database Schema" to try again.`);
				return 'failed';
			}
			if (!schema) {
				// Disconnected between the two calls, which a user can do at any moment.
				this._log.info(`No schema for ${connection.name}: it is no longer connected.`);
				return 'disconnected';
			}
			this._schemas.set(connection.profileId, schema);
			if (schema.truncated) {
				this._log.info(`The schema of ${connection.name} is larger than the completion limit;`
					+ ' some tables or columns will be missing from completions, and table names will'
					+ ' not be reported as unknown.');
			}
			const outcome = outcomeOf(connection, schema);
			this._log.debug(`${connection.name} (${connection.driverName}): ${describeTables(outcome.tables)}`
				+ ` in ${Date.now() - started}ms.`);
			return outcome;
		} catch (error) {
			this._log.warn(`Could not read the schema of ${connection.name}: ${error}`);
			return 'failed';
		} finally {
			clearTimeout(timer);
		}
	}

	/** Waits on a walk of a connection's schema, joining one already in flight rather than starting another. */
	private _join(profileId: string): Walk {
		let walk = this._walks.get(profileId);
		if (!walk) {
			const cancellation = new vscode.CancellationTokenSource();
			const started: Walk = {
				schema: Promise.resolve(this._api.getSchema(profileId, SCHEMA_BOUNDS, cancellation.token)),
				cancellation,
				waiting: 0,
			};
			const done = () => {
				if (this._walks.get(profileId) === started) {
					this._walks.delete(profileId);
				}
				cancellation.dispose();
			};
			started.schema.then(done, done);
			this._walks.set(profileId, started);
			walk = started;
		}
		walk.waiting++;
		return walk;
	}

	/**
	 * Stops waiting on a walk, cancelling it if nothing else is waiting on it.
	 *
	 * Dropped from the walks in flight at once rather than when it settles: a cancelled walk stops
	 * only at its next fetch, and the next read should start one of its own rather than join it.
	 */
	private _leave(profileId: string, walk: Walk): void {
		if (--walk.waiting > 0) {
			return;
		}
		walk.cancellation.cancel();
		if (this._walks.get(profileId) === walk) {
			this._walks.delete(profileId);
		}
	}

	/** Cancels every walk in flight: nothing will read what they find. */
	public dispose(): void {
		for (const walk of this._walks.values()) {
			walk.cancellation.cancel();
		}
		this._walks.clear();
	}
}

/** A walk of one connection's schema; see {@link SchemaReader._walks}. */
interface Walk {
	readonly schema: Promise<positron.DataConnectionSchema | undefined>;
	readonly cancellation: vscode.CancellationTokenSource;
	/** Reads still waiting on it. */
	waiting: number;
}

/** The tables one connection's schema holds, and whether that is all of them. */
function outcomeOf(
	connection: positron.DataConnectionSummary,
	schema: positron.DataConnectionSchema,
): { readonly tables: SqlTable[]; readonly truncated: boolean } {
	return {
		tables: flattenSchemaNodes(schema.nodes, connection.name, connection.profileId),
		truncated: schema.truncated,
	};
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
