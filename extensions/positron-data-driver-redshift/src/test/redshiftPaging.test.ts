/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	BackendState,
	ColumnDisplayType,
	ExportFormat,
	FormatOptions,
	TableSelectionKind,
} from 'positron-data-explorer-protocol';
import { RESULT_WINDOW_ROWS } from 'positron-data-explorer-window';
import { IRedshiftQueryClient, RedshiftSchemaEntry, RedshiftTableView } from '../redshiftTableView.js';

const FORMAT: FormatOptions = {
	large_num_digits: 2,
	small_num_digits: 4,
	max_integral_digits: 7,
	max_value_length: 100,
};

/**
 * A low-cardinality first column, followed by a unique key column. Paging is checked against `id`,
 * which appears second on purpose: a driver that reaches for column zero picks `status` and tears.
 */
const SCHEMA: RedshiftSchemaEntry[] = [
	{ column_name: 'status', column_type: 'character varying', type_display: ColumnDisplayType.String },
	{ column_name: 'id', column_type: 'integer', type_display: ColumnDisplayType.Integer },
];

const TABLE = '"public"."x"';
const ROWS = 1000;
const PAGE = 100;
const STATUSES = 3;

const statusOf = (id: number) => `s${id % STATUSES}`;

/**
 * A fake query client standing in for a server that returns tied rows in any order it likes,
 * because the ORDER BY does not distinguish them. The order is stable within one statement and
 * re-permuted for each new statement.
 *
 * The permutation is a rotation by one, the smallest total re-ordering there is: a paged sweep then
 * drops precisely one row per page boundary, so a failure is unambiguous rather than a scrambled
 * diff.
 */
class UnstableOrderClient implements IRedshiftQueryClient {
	/** Statements that read rows of the relation, as opposed to counting them. */
	baseRelationReads = 0;

	private rotation = 0;

	constructor(private readonly rowCount: number) { }

	async runQuery(sql: string): Promise<Array<Record<string, unknown>>> {
		if (sql.includes('count(*)')) {
			return [{ n: this.rowCount }];
		}
		this.baseRelationReads++;

		// Ordering by the unique key pins the order completely. Without it, rows the ORDER BY leaves
		// tied may come back in a different order on every statement.
		const pinned = /ORDER BY[^)]*"id"/.test(sql);
		if (!pinned) {
			this.rotation++;
		}

		// Rows the ORDER BY cannot tell apart form one tie group. Ordering by `status` alone leaves
		// three large groups; with no ORDER BY at all the whole table is a single group.
		const groups = /ORDER BY\s+"status"/.test(sql) ? this._statusGroups() : [this._allRows()];
		const order: number[] = [];
		for (const group of groups) {
			const by = pinned ? 0 : this.rotation % group.length;
			order.push(...group.slice(by), ...group.slice(0, by));
		}

		// A ROW_NUMBER() read selects listed positions of that order; any other read, a LIMIT/OFFSET
		// span of it.
		let positions: number[];
		const listed = /IN \((?<list>[\d, ]+)\)/.exec(sql);
		if (sql.includes('ROW_NUMBER()') && listed?.groups) {
			positions = listed.groups.list.split(',').map(Number);
		} else {
			const span = /LIMIT (?<limit>\d+)(?: OFFSET (?<offset>\d+))?/.exec(sql);
			const offset = Number(span?.groups?.offset ?? 0);
			const limit = Number(span?.groups?.limit ?? this.rowCount);
			positions = Array.from({ length: Math.max(0, Math.min(limit, this.rowCount - offset)) }, (_, i) => offset + i);
		}

		const selected = [...sql.matchAll(/"(?<name>\w+)" AS (?<alias>c\d+)/g)]
			.map(match => ({ name: match.groups!.name, alias: match.groups!.alias }));
		return positions.map(position => {
			const id = order[position];
			const row: Record<string, unknown> = {};
			for (const { name, alias } of selected) {
				row[alias] = name === 'id' ? id : statusOf(id);
			}
			return row;
		});
	}

	private _allRows(): number[] {
		return Array.from({ length: this.rowCount }, (_, i) => i);
	}

	private _statusGroups(): number[][] {
		return Array.from({ length: STATUSES },
			(_, s) => this._allRows().filter(id => statusOf(id) === `s${s}`));
	}
}

/** Reads one page of the `id` column through the Data Explorer data path. */
async function readPage(view: RedshiftTableView, first: number, count: number): Promise<number[]> {
	const data = await view.getDataValues({
		columns: [{ column_index: 1, spec: { first_index: first, last_index: first + count - 1 } }],
		format_options: FORMAT,
	});
	return data.columns[0].map(Number);
}

/** Pages through the whole table the way scrolling from top to bottom does. */
async function sweep(view: RedshiftTableView): Promise<number[]> {
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

/** The ids an export holds, read back out of the trailing id column of each CSV line. */
const exportedIds = (csv: string) => csv.trim().split('\n').slice(1).map(line => Number(line.split(',').pop()));

/**
 * The paging invariants. Every name is shared verbatim with the sibling drivers' paging suites, so
 * `grep` across the drivers shows which of them assert which invariant.
 */
function pagingInvariants(): void {
	const open = (client = new UnstableOrderClient(ROWS)) =>
		new RedshiftTableView(client, TABLE, 'x', 'table', SCHEMA);

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

		assert.deepStrictEqual(exportedIds(exported.data), shown);
	});

	test('copied cells match the rows shown at those positions', async () => {
		const view = open();
		const shown = await readPage(view, 0, ROWS);
		// Copy sends cell indices, in the order the rows are laid out in the grid.
		const rows = [900, 3, 501];

		const exported = await view.exportDataSelection({
			selection: {
				kind: TableSelectionKind.CellIndices,
				selection: { row_indices: rows, column_indices: [0, 1] },
			},
			format: ExportFormat.Csv,
		});

		assert.deepStrictEqual(exportedIds(exported.data), rows.map(row => shown[row]));
	});

	test('a sweep sorted by a low-cardinality column returns every row exactly once', async () => {
		const view = open();
		// Sorting by `status` groups the rows correctly but leaves ~333 of them tied at a time, so
		// a page boundary inside a tie group needs a tiebreaker to stay exact.
		await view.setSortColumns({ sort_keys: [{ column_index: 0, ascending: true }] });

		assert.deepStrictEqual(
			coverage(await sweep(view)),
			{ total: ROWS, duplicated: [], missing: [] },
		);
	});
}

suite('Redshift paging stability', () => {
	// Redshift enforces no keys, so every table and view is read from a result window.
	suite('no row identity', () => {
		pagingInvariants();

		test('a sweep reads the relation once', async () => {
			const client = new UnstableOrderClient(ROWS);
			await sweep(new RedshiftTableView(client, TABLE, 'x', 'table', SCHEMA));
			assert.strictEqual(client.baseRelationReads, 1);
		});

		test('a relation longer than the window serves the window and reports the total', async () => {
			const view = new RedshiftTableView(new UnstableOrderClient(RESULT_WINDOW_ROWS + 10), TABLE, 'x', 'table', SCHEMA);
			const state: BackendState = await view.getState();
			assert.deepStrictEqual(
				{ rows: state.table_shape.num_rows, total: state.total_num_rows },
				{ rows: RESULT_WINDOW_ROWS, total: RESULT_WINDOW_ROWS + 10 },
			);
		});

		test('a window that cannot be read leaves the view open with its count, and its rows fail', async () => {
			// As a sort on a column the engine cannot order by does: the count runs, the rows do not.
			const client: IRedshiftQueryClient = {
				runQuery: async (sql: string) => {
					if (sql.includes('count(*)')) {
						return [{ n: ROWS }];
					}
					throw new Error('cannot read');
				},
			};
			const view = new RedshiftTableView(client, TABLE, 'x', 'table', SCHEMA);
			const state = await view.getState();
			await assert.rejects(readPage(view, 0, PAGE), /cannot read/);
			assert.deepStrictEqual(
				{ rows: state.table_shape.num_rows, total: state.total_num_rows },
				{ rows: ROWS, total: undefined },
			);
		});

		test('a relation within the window reports no total', async () => {
			const state = await new RedshiftTableView(new UnstableOrderClient(ROWS), TABLE, 'x', 'table', SCHEMA).getState();
			assert.deepStrictEqual(
				{ rows: state.table_shape.num_rows, total: state.total_num_rows },
				{ rows: ROWS, total: undefined },
			);
		});

		test('a sort change reads the new order rather than the rows held for the old one', async () => {
			const view = new RedshiftTableView(new UnstableOrderClient(ROWS), TABLE, 'x', 'table', SCHEMA);
			await readPage(view, 0, PAGE);
			await view.setSortColumns({ sort_keys: [{ column_index: 0, ascending: true }] });
			const statuses = (await view.getDataValues({
				columns: [{ column_index: 0, spec: { first_index: 0, last_index: ROWS - 1 } }],
				format_options: FORMAT,
			})).columns[0];
			assert.deepStrictEqual(statuses, [...statuses].sort());
		});
	});
});
