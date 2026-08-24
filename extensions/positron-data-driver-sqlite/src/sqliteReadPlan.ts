/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { quoteIdentifier } from './sqliteSql.js';
import { ISqliteQueryClient } from './sqliteWorkerClient.js';

/**
 * How a Data Explorer view reads one relation so that its LIMIT/OFFSET paging is stable.
 *
 * The Data Explorer fetches each page with a separate statement, and SQLite returns rows in
 * whatever order the chosen query plan produces. That plan is not fixed for the life of a tab:
 * another connection creating an index, or running ANALYZE, is enough to change it between two page
 * fetches. Once it changes, the pages stop partitioning the relation -- some rows come back on two
 * pages and others never arrive -- while the row count, which comes from a separate `count(*)`,
 * stays correct and hides the damage.
 *
 * A read plan pins down a total order that survives such a change. Relations that have no row
 * identity to order by are read through a materialized snapshot that does.
 */
export interface ISqliteReadPlan {
	/**
	 * The quoted relation every read should target, materializing the snapshot first if this plan
	 * uses one. Called before each read, so it must stay cheap once the snapshot is in place.
	 */
	relation(): Promise<string>;

	/**
	 * An ORDER BY expression that totally orders {@link relation}.
	 *
	 * Paging queries append it, so LIMIT/OFFSET is reproducible. Index-based exports also use it as
	 * their `ROW_NUMBER()` window order, so the rows an export returns are the rows the grid
	 * displayed at those positions.
	 */
	readonly rowOrder: string;

	/** Drops any snapshot this plan created. Safe to call more than once. */
	dispose(): Promise<void>;
}

/**
 * Chooses how to read a table or view so that paging it is stable.
 *
 * An ordinary table is read in place and ordered by its rowid, which is SQLite's own storage order,
 * so an unfiltered page fetch plans identically with and without the clause. A WITHOUT ROWID table
 * has no rowid column at all -- ordering by it fails with "no such column: rowid" -- but its primary
 * key is a clustered index whose columns SQLite implicitly marks NOT NULL, so it is a genuine total
 * order and plans the same way. Once a row filter is in play the clause can cost a plan rather than
 * come free; `_buildSortClause` in `sqliteTableView.ts` measures where and says why it is still
 * stated.
 *
 * Anything else is read through a snapshot: a view has no row identity, and neither does a table
 * whose identity cannot be established.
 *
 * @param columnNames Every column the relation emits. Consulted only on the snapshot path, and only
 * to find a rowid alias the relation does not shadow, so it must be the relation's full column list
 * rather than whichever subset a caller means to display.
 */
export async function createSqliteReadPlan(
	client: ISqliteQueryClient,
	tableName: string,
	kind: 'table' | 'view',
	columnNames: readonly string[],
): Promise<ISqliteReadPlan> {
	const quotedTable = quoteIdentifier(tableName);
	if (kind === 'table') {
		const identity = await resolveRowIdentity(client, quotedTable);
		if (identity !== undefined) {
			return new DirectRead(quotedTable, identity);
		}
	}
	return new SnapshotRead(client, quotedTable, columnNames);
}

/** SQLite's interchangeable spellings of the implicit rowid, in the order to prefer them. */
const ROWID_ALIASES = ['rowid', '_rowid_', 'oid'];

/** Names a snapshot's own ordering column, for a source that leaves no rowid alias unshadowed. */
const SNAPSHOT_ORDER_COLUMN = '__positron_row_order';

/**
 * Resolves an ORDER BY expression that uniquely identifies a row of the given table, or undefined
 * if the table has none.
 */
async function resolveRowIdentity(
	client: ISqliteQueryClient,
	quotedTable: string,
): Promise<string | undefined> {
	// PRAGMA table_info reports one row per declared column, with `pk` as the 1-based position of the
	// column within the primary key, or 0 when the column is not part of it. PRAGMA takes no bound
	// parameters, so the table name is escaped inline.
	const columns = await client.runQuery(`PRAGMA table_info(${quotedTable})`);

	// A declared column is allowed to take the name of a rowid alias, and it then shadows the rowid:
	// given `CREATE TABLE t(rowid TEXT, v INTEGER)`, `SELECT rowid` returns that TEXT column, which
	// carries no uniqueness whatsoever. Because SQLite keeps three spellings of the rowid, a shadowed
	// one only means preferring the next. Names are compared case-insensitively, since that is how
	// SQLite resolves identifiers.
	const declared = new Set(columns.map(row => String(row.name).toLowerCase()));
	const alias = ROWID_ALIASES.find(candidate => !declared.has(candidate));
	if (alias === undefined) {
		// All three spellings are taken, so nothing can name this table's rowid. Its declared primary
		// key is no substitute -- see below -- so the table is read through a snapshot.
		return undefined;
	}

	try {
		// Selecting no rows makes this a bind-time check, so it costs nothing to run. It is also the
		// only exact test available: no pragma reports whether a table is WITHOUT ROWID, and the
		// CREATE statement in sqlite_master cannot be trusted, because a string literal or a comment
		// can contain the words (`note TEXT DEFAULT 'migrated without rowid'` is an ordinary table).
		await client.runQuery(`SELECT ${alias} FROM ${quotedTable} LIMIT 0`);
		return alias;
	} catch (error) {
		if (!isNoSuchColumn(error)) {
			// A dead worker or a disposed connection landed here, not a WITHOUT ROWID table. The
			// primary key below is only a total order for a table that genuinely has no rowid, so
			// treating this as one risks paging an ordinary table by a nullable key. Fail the open
			// instead, which the user can retry, rather than opening a tab that silently loses rows.
			throw error;
		}
	}

	const keyColumns = columns
		.filter(row => Number(row.pk ?? 0) > 0)
		.sort((a, b) => Number(a.pk) - Number(b.pk))
		.map(row => quoteIdentifier(String(row.name)));
	if (keyColumns.length === 0) {
		return undefined;
	}

	// Reached only for a WITHOUT ROWID table, whose primary key is a clustered index over columns
	// SQLite implicitly marks NOT NULL: a genuine total order, and free to sort by. An ordinary
	// table's declared primary key would not do, because SQLite allows NULLs in a PRIMARY KEY column
	// unless it is INTEGER PRIMARY KEY, and a unique index treats every NULL as distinct, so several
	// rows can tie.
	return keyColumns.join(', ');
}

/**
 * Whether an error is SQLite reporting an unresolvable column, which is how a WITHOUT ROWID table
 * answers a rowid probe ("no such column: rowid").
 *
 * The message is matched because the code cannot be: better-sqlite3 reports every statement error as
 * SQLITE_ERROR. Should SQLite ever reword this, a WITHOUT ROWID table would fail to open rather than
 * open with unstable paging, which is the safe direction for this to be wrong in.
 */
function isNoSuchColumn(error: unknown): boolean {
	return error instanceof Error && /no such column/i.test(error.message);
}

/** Reads a relation in place, ordered by an expression that uniquely identifies one of its rows. */
class DirectRead implements ISqliteReadPlan {
	constructor(
		private readonly _quotedTable: string,
		readonly rowOrder: string,
	) { }

	async relation(): Promise<string> {
		return this._quotedTable;
	}

	async dispose(): Promise<void> {
		// Nothing was created, so nothing to release.
	}
}

/**
 * Distinguishes the snapshots of concurrently open views within one worker's `temp` schema. Every
 * view served by a given worker is created through this module, so the counter covers them all; and
 * because the CREATE below is not `IF NOT EXISTS`, a name that did somehow repeat would fail loudly
 * rather than let two views quietly read each other's rows.
 */
let snapshotCount = 0;

/**
 * Reads a relation through a TEMP table holding a point-in-time copy of its rows.
 *
 * A snapshot both supplies the missing row identity -- a TEMP table has a rowid that records the
 * order rows were inserted, reachable under whichever of its names the copied columns leave free --
 * and stops the relation being recomputed on every page. For a view over a join or an aggregate that
 * makes paging substantially cheaper than reading the view directly, because the join runs once
 * instead of once per page.
 *
 * The copy lives in the `temp` schema, which is private to this connection and invisible to `main`,
 * so it cannot collide with the user's own objects. It is created even when the database was opened
 * read-only, because `temp` is a separate database that is always writable.
 */
class SnapshotRead implements ISqliteReadPlan {
	readonly rowOrder: string;

	/** Unqualified and quoted, for CREATE, which does not accept a schema-qualified name. */
	private readonly _quotedName: string;
	/** Schema-qualified, so a same-named table in `main` cannot be read by mistake. */
	private readonly _qualifiedName: string;
	/** The snapshot's select list, which numbers rows explicitly only when it has to. */
	private readonly _selectList: string;

	private _materialized: Promise<string> | undefined;
	private _disposed = false;
	private readonly _crashSubscription: { dispose(): void } | undefined;

	constructor(
		private readonly _client: ISqliteQueryClient,
		private readonly _quotedSource: string,
		sourceColumns: readonly string[],
	) {
		this._quotedName = quoteIdentifier(`positron_snapshot_${++snapshotCount}`);
		this._qualifiedName = `temp.${this._quotedName}`;

		// `SELECT *` copies the source's columns verbatim, so a source that emits a column named like a
		// rowid alias shadows the snapshot's own rowid. `CREATE VIEW v AS SELECT rowid, name FROM t` is
		// idiomatic enough to expect, and while the rowid it copies happens to be unique, a join that
		// fans that view out, or anything aliased `AS rowid`, is not: measured against SQLite 3.51, the
		// snapshot of such a view read 1, 1, 2, 3, 3 under `rowid` and 1, 2, 3, 4, 5 under `_rowid_`.
		// Ordering by the shadowed name would leave paging exactly as unstable as it was before any of
		// this, with nothing to show for it.
		// Preferring the next alias keeps the free path: a TEMP table's rowid is its storage order, so
		// SQLite sorts nothing to apply it.
		const taken = new Set(sourceColumns.map(name => name.toLowerCase()));
		const alias = ROWID_ALIASES.find(candidate => !taken.has(candidate));
		if (alias !== undefined) {
			this.rowOrder = alias;
			this._selectList = '*';
		} else {
			// The source emits all three spellings, so no name reaches the snapshot's rowid. Number the
			// rows in a column of our own instead. That column is unindexed, so each page pays a sort to
			// apply it, which is worth accepting for a shape this rare. Reads never see it: every one of
			// them projects an explicit column list taken from the schema.
			const ordinal = quoteIdentifier(SNAPSHOT_ORDER_COLUMN);
			this.rowOrder = ordinal;
			this._selectList = `ROW_NUMBER() OVER () AS ${ordinal}, *`;
		}

		// A replacement worker starts with an empty `temp` schema, so the snapshot is gone even
		// though this object still holds a resolved promise for it. Forget it, so the next read
		// rebuilds instead of failing with "no such table" until the user reopens the tab.
		this._crashSubscription = this._client.onDidCrash?.(() => {
			this._materialized = undefined;
		});
	}

	relation(): Promise<string> {
		// A read can outlive the view that issued it -- closing a tab mid column-profile disposes this
		// plan while that profile is still awaiting its turn on the worker. Materializing again here
		// would create a snapshot that nothing is left to drop, so it stays for the life of the
		// connection.
		if (this._disposed) {
			return Promise.reject(new Error('Cannot read through a disposed SQLite read plan'));
		}
		return this._materialized ??= this._materialize();
	}

	private async _materialize(): Promise<string> {
		try {
			await this._client.runQuery(
				`CREATE TEMP TABLE ${this._quotedName} AS ` +
				`SELECT ${this._selectList} FROM ${this._quotedSource}`);
			return this._qualifiedName;
		} catch (error) {
			// Clear the memo so a later read retries, rather than leaving the tab permanently broken
			// by one transient failure.
			this._materialized = undefined;
			throw error;
		}
	}

	async dispose(): Promise<void> {
		this._disposed = true;
		this._crashSubscription?.dispose();
		const materialized = this._materialized;
		this._materialized = undefined;
		if (materialized === undefined) {
			return;
		}
		try {
			await materialized;
			await this._client.runQuery(`DROP TABLE IF EXISTS ${this._qualifiedName}`);
		} catch {
			// The snapshot is discarded with the connection's `temp` schema in any case, so a failure
			// here (a dead worker, a snapshot that never finished materializing) leaks nothing.
		}
	}
}
