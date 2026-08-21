/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { quoteIdentifier } from './duckdbSql.js';
import { IDuckDBQueryClient } from './duckdbWorkerClient.js';

/**
 * How a Data Explorer view reads one relation so that its LIMIT/OFFSET paging is stable.
 *
 * The Data Explorer fetches each page with a separate statement, which is only safe while every one
 * of those statements sees the relation in the same order. DuckDB gives that guarantee for a scan,
 * through `preserve_insertion_order` (pinned in `duckdbWorker.ts`), so paging a table needs no
 * ORDER BY at all -- and must not add one, because DuckDB cannot tell that `rowid` order is already
 * the scan order and would sort the whole relation on every page instead.
 *
 * The guarantee does not extend to a relation whose order is not derived from a scan. A view over a
 * join, an aggregate, a DISTINCT, or a window function is built by hash operators that have no input
 * order to preserve, so each statement can emit a different permutation. Measured against DuckDB
 * 1.5.5, sweeping a 500,000-row join view a page at a time repeated 170,032 rows and missed 170,032
 * others. Those relations are read through a snapshot, which gives them a scan to page over.
 */
export interface IDuckDBReadPlan {
	/**
	 * The quoted relation every read should target, materializing the snapshot first if this plan
	 * uses one. Called before each read, so it must stay cheap once the snapshot is in place.
	 */
	relation(): Promise<string>;

	/**
	 * An ORDER BY expression that totally orders {@link relation}, matching the order pages come
	 * back in.
	 *
	 * Paging queries only state it once the user has sorted, where the sort is paid for anyway and
	 * the expression breaks ties between equal keys. Index-based exports always state it, because a
	 * ROW_NUMBER() window does not inherit the scan's insertion order -- numbering rows without it
	 * disagreed with the displayed order on every row of a measured 171,429-row relation, so the
	 * exported file held rows the user never selected.
	 */
	readonly rowOrder: string;

	/** Drops any snapshot this plan created. Safe to call more than once. */
	dispose(): Promise<void>;
}

/**
 * Chooses how to read a table or view so that paging it is stable.
 *
 * A table is read in place: every DuckDB base table has a `rowid`, and a scan of it already comes
 * back in insertion order. A view has no `rowid` and no guaranteed order, so it is read through a
 * snapshot.
 *
 * @param columnNames Every column the relation emits. Consulted only on the snapshot path, and only
 * to detect a column named `rowid` that would shadow the snapshot's own, so it must be the
 * relation's full column list rather than whichever subset a caller means to display.
 */
export function createDuckDBReadPlan(
	client: IDuckDBQueryClient,
	tableRef: string,
	kind: 'table' | 'view',
	columnNames: readonly string[],
): IDuckDBReadPlan {
	return kind === 'table'
		? new DirectRead(tableRef)
		: new SnapshotRead(client, tableRef, columnNames);
}

/** Reads a relation in place, relying on DuckDB to return a scan in insertion order. */
class DirectRead implements IDuckDBReadPlan {
	readonly rowOrder = 'rowid';

	constructor(private readonly _tableRef: string) { }

	async relation(): Promise<string> {
		return this._tableRef;
	}

	async dispose(): Promise<void> {
		// Nothing was created, so nothing to release.
	}
}

/**
 * Distinguishes the snapshots of concurrently open views within one worker's `temp` catalog.
 *
 * One worker serves every connection that a given extension opens to the same file, and all of
 * those views are created through this module, so the counter covers them. A second extension
 * bundles its own copy of this package and gets its own worker process, hence its own `temp`
 * catalog, so its numbering cannot reach this one. And because the CREATE below is not
 * `IF NOT EXISTS`, a name that did somehow repeat would fail loudly rather than let two views
 * quietly read each other's rows.
 */
let snapshotCount = 0;

/** Names a snapshot's own ordering column, for a view that emits a column named `rowid`. */
const SNAPSHOT_ORDER_COLUMN = '__positron_row_order';

/**
 * Reads a relation through a TEMP table holding a point-in-time copy of its rows.
 *
 * A snapshot turns a relation with no inherent order into one with a scan order, and it stops the
 * relation being recomputed per page. For a view over a join that makes paging cheaper than reading
 * the view directly, because the join runs once rather than once per page: a measured 500,000-row
 * join view swept in 392 ms through a snapshot against 840 ms directly, after a 6 ms build.
 *
 * The copy lives in the `temp` catalog, which is private to this connection, so it cannot collide
 * with the user's own objects. It is created even when the database was opened read-only, because
 * `temp` is a separate catalog that stays writable.
 */
class SnapshotRead implements IDuckDBReadPlan {
	readonly rowOrder: string;

	/** Unqualified, for CREATE, which does not accept a catalog-qualified name. */
	private readonly _quotedName: string;
	/** Catalog-qualified, so a same-named table in `main` cannot be read by mistake. */
	private readonly _qualifiedName: string;
	/** The snapshot's select list, which numbers rows explicitly only when it has to. */
	private readonly _selectList: string;

	private _materialized: Promise<string> | undefined;
	private _disposed = false;
	private readonly _crashSubscription: { dispose(): void } | undefined;

	constructor(
		private readonly _client: IDuckDBQueryClient,
		private readonly _viewRef: string,
		sourceColumns: readonly string[],
	) {
		this._quotedName = quoteIdentifier(`positron_snapshot_${++snapshotCount}`);
		this._qualifiedName = `temp.${this._quotedName}`;

		// `SELECT *` copies the view's columns verbatim, so a view that emits a column named `rowid`
		// shadows the snapshot's own rowid, and ordering by that name silently reads the copied column
		// instead: measured against DuckDB 1.5.5, the snapshot of a join view that emits `rowid` read
		// 0, 0, 1, 2, 2 under that name, three distinct values across five rows. Unlike SQLite, DuckDB
		// has no second spelling of the rowid to fall back on, so the rows are numbered in a column of
		// our own. That column is unindexed, so each page pays a sort to apply it -- worth accepting for
		// a shape this rare, and paid only by the views that hit it. Reads
		// never see the column: every one of them projects an explicit column list from the schema, and
		// the export path's `SELECT *` is confined to a subquery the outer projection filters.
		const shadowed = sourceColumns.some(name => name.toLowerCase() === 'rowid');
		if (shadowed) {
			const ordinal = quoteIdentifier(SNAPSHOT_ORDER_COLUMN);
			this.rowOrder = ordinal;
			this._selectList = `ROW_NUMBER() OVER () AS ${ordinal}, *`;
		} else {
			this.rowOrder = 'rowid';
			this._selectList = '*';
		}

		// A replacement worker starts with an empty `temp` catalog, so the snapshot is gone even
		// though this object still holds a resolved promise for it. Forget it, so the next read
		// rebuilds instead of failing until the user reopens the tab.
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
			return Promise.reject(new Error('Cannot read through a disposed DuckDB read plan'));
		}
		return this._materialized ??= this._materialize();
	}

	private async _materialize(): Promise<string> {
		try {
			await this._client.runQuery(
				`CREATE TEMP TABLE ${this._quotedName} AS ` +
				`SELECT ${this._selectList} FROM ${this._viewRef}`);
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
			// The snapshot goes away with the connection's `temp` catalog in any case, so a failure
			// here (a dead worker, a snapshot that never finished materializing) leaks nothing.
		}
	}
}
