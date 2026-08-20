/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { SqliteSchemaEntry, SqliteTableView } from '../sqliteTableView.js';
import { ISqliteQueryClient, SqliteRow } from '../sqliteWorkerClient.js';
import { SqliteBindValue } from '../sqliteWorkerProtocol.js';
import {
	ColumnDisplayType,
	ExportFormat,
	FormatOptions,
	TableSelectionKind,
} from 'positron-data-explorer-protocol';

const FORMAT: FormatOptions = {
	large_num_digits: 2,
	small_num_digits: 4,
	max_integral_digits: 7,
	max_value_length: 100,
};

/**
 * A unique integer column, so a paged read can be checked against the row set exactly, plus a
 * low-cardinality column to sort by. Sorting by `status` leaves large groups of rows tied, which is
 * where a partial ORDER BY stops being enough.
 */
const SCHEMA: SqliteSchemaEntry[] = [
	{ column_name: 'id', column_type: 'INTEGER', type_display: ColumnDisplayType.Integer },
	{ column_name: 'status', column_type: 'TEXT', type_display: ColumnDisplayType.String },
];

const TABLE = 'x';
const ROWS = 1000;
const PAGE = 100;
const STATUSES = 3;

const statusOf = (id: number) => `s${id % STATUSES}`;

/**
 * A fake query client standing in for an engine that returns tied rows in any order it likes,
 * because the ORDER BY does not distinguish them. The order is stable within one statement and
 * re-permuted for each new statement.
 *
 * SQLite scans a single B-tree in a single thread, so in practice it is far more stable than this
 * fake -- but the guarantee is absent either way, and these are the invariants the paging code has
 * to hold regardless of how forgiving the engine happens to be.
 */
class UnstableOrderClient implements ISqliteQueryClient {
	/** Reads that scan the base relation, i.e. the expensive ones a snapshot should not multiply. */
	baseRelationReads = 0;

	private rotation = 0;

	constructor(private readonly rowCount: number) { }

	async runQuery(sql: string, _params?: SqliteBindValue[]): Promise<SqliteRow[]> {
		if (sql.includes('count(*)')) {
			return [{ n: this.rowCount }];
		}
		if (sql.includes(`"${TABLE}"`)) {
			this.baseRelationReads++;
		}

		// A unique tiebreaker pins the order completely. Without one, rows the ORDER BY leaves tied
		// may come back in a different order on every statement. Here that means `rowid`, a snapshot
		// row number, or `"id"` -- which is unique in this fixture, and is what a WITHOUT ROWID
		// table's primary key resolves to.
		const pinned = /ORDER BY[^)]*(?:\browid\b|\b__rn\b|"id")/.test(sql);
		if (!pinned) {
			this.rotation++;
		}

		// Rows that the ORDER BY cannot tell apart form one tie group. With no ORDER BY at all every
		// row is tied with every other, so the whole table is a single group.
		const groups = /ORDER BY\s+"status"/.test(sql) ? this._statusGroups() : [this._allRows()];
		const order: number[] = [];
		for (const group of groups) {
			const by = pinned ? 0 : this.rotation % group.length;
			order.push(...group.slice(by), ...group.slice(0, by));
		}

		const window = /LIMIT (\d+) OFFSET (\d+)/.exec(sql);
		const [offset, limit] = window
			? [Number(window[2]), Number(window[1])]
			: [0, this.rowCount];
		return order.slice(offset, offset + limit)
			.map(id => ({ c0: id, c1: statusOf(id) }));
	}

	private _allRows(): number[] {
		return Array.from({ length: this.rowCount }, (_, i) => i);
	}

	private _statusGroups(): number[][] {
		return Array.from({ length: STATUSES },
			(_, s) => this._allRows().filter(id => statusOf(id) === `s${s}`));
	}
}

/** Reads one page through the Data Explorer data path and returns the ids it produced. */
async function readPage(view: SqliteTableView, first: number, count: number): Promise<number[]> {
	const data = await view.getDataValues({
		columns: [{ column_index: 0, spec: { first_index: first, last_index: first + count - 1 } }],
		format_options: FORMAT,
	});
	return data.columns[0].map(Number);
}

/** Pages through the whole table the way scrolling from top to bottom does. */
async function sweep(view: SqliteTableView): Promise<number[]> {
	const seen: number[] = [];
	for (let first = 0; first < ROWS; first += PAGE) {
		seen.push(...await readPage(view, first, PAGE));
	}
	return seen;
}

/** Summarizes read ids against the rows that should have been returned exactly once. */
function coverage(seen: number[]) {
	const counts = new Map<number, number>();
	for (const id of seen) {
		counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	return {
		total: seen.length,
		duplicated: [...counts].filter(([, n]) => n > 1).map(([id]) => id),
		missing: Array.from({ length: ROWS }, (_, i) => i).filter(id => !counts.has(id)),
	};
}

/**
 * The paging invariants, run against a given row identity. Every name is shared verbatim with the
 * sibling drivers' paging suites, so `grep` across the drivers shows which of them assert which
 * invariant.
 */
function pagingInvariants(objectKind: 'table' | 'view', rowIdentity: string | undefined): void {
	const open = () => new SqliteTableView(
		new UnstableOrderClient(ROWS), TABLE, objectKind, SCHEMA, rowIdentity);

	test('a full sequential sweep returns every row exactly once', async () => {
		assert.deepStrictEqual(
			coverage(await sweep(open())),
			{ total: ROWS, duplicated: [], missing: [] },
		);
	});

	test('re-reading a range returns the same rows', async () => {
		const view = open();
		// The rows at a position must be a property of the table, not of how it was reached.
		const before = await readPage(view, 500, PAGE);
		await readPage(view, 0, PAGE);

		assert.deepStrictEqual(await readPage(view, 500, PAGE), before);
	});

	test('an exported range matches the rows shown for that range', async () => {
		const view = open();
		const shown = await readPage(view, 500, PAGE);

		const exported = await view.exportDataSelection({
			selection: {
				kind: TableSelectionKind.RowRange,
				selection: { first_index: 500, last_index: 500 + PAGE - 1 },
			},
			format: ExportFormat.Csv,
		});
		// Drop the header row, then read the leading id column back out of each line.
		const ids = exported.data.trim().split('\n').slice(1)
			.map(line => Number(line.split(',')[0]));

		assert.deepStrictEqual(ids, shown);
	});

	test('a sweep sorted by a low-cardinality column returns every row exactly once', async () => {
		const view = open();
		// Sorting by `status` groups the rows correctly but leaves ~333 of them tied at a time, so
		// a page boundary inside a tie group needs a tiebreaker to stay exact.
		await view.setSortColumns({ sort_keys: [{ column_index: 1, ascending: true }] });

		assert.deepStrictEqual(
			coverage(await sweep(view)),
			{ total: ROWS, duplicated: [], missing: [] },
		);
	});
}

suite('SQLite paging stability', () => {
	suite('table', () => {
		pagingInvariants('table', 'rowid');
	});

	// A WITHOUT ROWID table has no rowid column at all, so its primary key stands in as the row
	// identity. See resolveSqliteRowIdentity.
	suite('table without rowid', () => {
		pagingInvariants('table', '"id"');
	});

	// Views have no row identity, so there is no tiebreaker to make LIMIT/OFFSET total. Pending the
	// materialized-snapshot work; see https://github.com/posit-dev/positron/issues/15361.
	suite.skip('view', () => {
		pagingInvariants('view', undefined);
	});
});
