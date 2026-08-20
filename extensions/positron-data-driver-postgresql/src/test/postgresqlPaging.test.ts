/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IPostgresQueryClient, PostgresSchemaEntry, PostgresTableView } from '../postgresqlTableView.js';
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
const SCHEMA: PostgresSchemaEntry[] = [
	{ column_name: 'id', column_type: 'integer', type_display: ColumnDisplayType.Integer },
	{ column_name: 'status', column_type: 'text', type_display: ColumnDisplayType.String },
];

const TABLE = '"public"."x"';
const ROWS = 1000;
const PAGE = 100;
const STATUSES = 3;

const statusOf = (id: number) => `s${id % STATUSES}`;

/**
 * A fake query client standing in for a server that returns tied rows in any order it likes,
 * because the ORDER BY does not distinguish them. The order is stable within one statement and
 * re-permuted for each new statement -- exactly the latitude PostgreSQL has here.
 *
 * The permutation is a rotation by one, the smallest total re-ordering there is: a LIMIT/OFFSET
 * sweep then drops precisely one row per page boundary, so a failure is unambiguous rather than a
 * scrambled diff.
 */
class UnstableOrderClient implements IPostgresQueryClient {
	/** Reads that scan the base relation, i.e. the expensive ones a snapshot should not multiply. */
	baseRelationReads = 0;

	private rotation = 0;

	constructor(private readonly rowCount: number) { }

	async runQuery(sql: string): Promise<Array<Record<string, unknown>>> {
		if (sql.includes('count(*)')) {
			return [{ n: this.rowCount }];
		}
		if (sql.includes(TABLE)) {
			this.baseRelationReads++;
		}

		// A unique tiebreaker -- a row identity, or a row number over a materialized snapshot --
		// pins the order completely. Without one, rows the ORDER BY leaves tied may come back in a
		// different order on every statement.
		const pinned = /ORDER BY[^)]*\b(?:ctid|__rn)\b/.test(sql);
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
async function readPage(view: PostgresTableView, first: number, count: number): Promise<number[]> {
	const data = await view.getDataValues({
		columns: [{ column_index: 0, spec: { first_index: first, last_index: first + count - 1 } }],
		format_options: FORMAT,
	});
	return data.columns[0].map(Number);
}

/** Pages through the whole table the way scrolling from top to bottom does. */
async function sweep(view: PostgresTableView): Promise<number[]> {
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
 * The paging invariants, run against a table or a view. Every name is shared verbatim with the
 * sibling drivers' paging suites, so `grep` across the drivers shows which of them assert which
 * invariant.
 */
function pagingInvariants(objectKind: 'table' | 'view'): void {
	const open = () => new PostgresTableView(
		new UnstableOrderClient(ROWS), TABLE, 'x', objectKind, SCHEMA);

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

suite('PostgreSQL paging stability', () => {
	suite('table', () => {
		pagingInvariants('table');
	});

	// Views have no ctid, so there is no tiebreaker to make LIMIT/OFFSET total. Pending the
	// materialized-snapshot work; see https://github.com/posit-dev/positron/issues/15361.
	suite.skip('view', () => {
		pagingInvariants('view');
	});

	// A cost invariant rather than a correctness one, and only achievable once reads are served from
	// a snapshot instead of re-scanning the source per page. Pending the same work.
	suite.skip('snapshot', () => {
		test('a full sequential sweep scans the base relation at most once', async () => {
			const client = new UnstableOrderClient(ROWS);
			const view = new PostgresTableView(client, TABLE, 'x', 'table', SCHEMA);

			await sweep(view);

			assert.ok(
				client.baseRelationReads <= 1,
				`scanned the source ${client.baseRelationReads} times to read ${ROWS / PAGE} pages`,
			);
		});
	});
});
