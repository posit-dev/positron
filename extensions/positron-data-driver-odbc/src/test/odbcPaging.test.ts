/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { OdbcDialect } from '../odbcDatabases.js';
import { OdbcTableRef } from '../odbcNodes.js';
import { OdbcSchemaEntry, OdbcTableView, resolveOdbcRowIdentity } from '../odbcTableView.js';
import { IOdbcQueryClient } from '../odbcWorkerClient.js';
import { OdbcRow } from '../odbcWorkerProtocol.js';
import {
	BackendState,
	ColumnDisplayType,
	ExportFormat,
	FormatOptions,
	TableSelectionKind,
} from 'positron-data-explorer-protocol';
import { RESULT_WINDOW_ROWS } from 'positron-data-explorer-window';

const FORMAT: FormatOptions = {
	large_num_digits: 2,
	small_num_digits: 4,
	max_integral_digits: 7,
	max_value_length: 100,
};

const LIMIT_OFFSET: OdbcDialect = { identifierQuote: '"', pagination: 'limit-offset' };
const OFFSET_FETCH: OdbcDialect = { identifierQuote: '"', pagination: 'offset-fetch' };
const ENFORCED_KEYS: OdbcDialect = { ...LIMIT_OFFSET, enforcesPrimaryKeys: true };
const ENFORCED_OFFSET_FETCH: OdbcDialect = { ...OFFSET_FETCH, enforcesPrimaryKeys: true };

/**
 * A low-cardinality first column, so the fallback tiebreaker is the weakest one a real table could
 * offer, followed by a unique key column. Paging is checked against `id`, which appears second on
 * purpose: a driver that reaches for column zero picks `status` and tears.
 */
const SCHEMA: OdbcSchemaEntry[] = [
	{ column_name: 'status', column_type: 'varchar', type_display: ColumnDisplayType.String, is_binary: false },
	{ column_name: 'id', column_type: 'int4', type_display: ColumnDisplayType.Integer, is_binary: false },
];

const REF: OdbcTableRef = { schema: 'public', name: 'x', kind: 'table' };
const ROWS = 1000;
const PAGE = 100;
const STATUSES = 3;

const statusOf = (id: number) => `s${id % STATUSES}`;

/**
 * A fake query client standing in for a backend that returns tied rows in any order it likes,
 * because the ORDER BY does not distinguish them. The order is stable within one statement and
 * re-permuted for each new statement.
 *
 * The permutation is a rotation by one, the smallest total re-ordering there is: a paged sweep then
 * drops precisely one row per page boundary, so a failure is unambiguous rather than a scrambled
 * diff.
 */
class UnstableOrderClient implements IOdbcQueryClient {
	/** Statements that read rows of the relation, as opposed to counting them. */
	baseRelationReads = 0;

	private rotation = 0;

	constructor(private readonly rowCount: number) { }

	async runQuery(sql: string): Promise<OdbcRow[]> {
		if (sql.includes('count(*)')) {
			return [{ n: this.rowCount }];
		}
		if (sql.includes('"x"')) {
			this.baseRelationReads++;
		}

		// Ordering by the unique key column pins the order completely, as would a row number over a
		// materialized snapshot. Without one, rows the ORDER BY leaves tied may come back in a
		// different order on every statement.
		const pinned = /ORDER BY[^)]*(?:"id"|__rn)/.test(sql);
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

		// A ROW_NUMBER() read selects listed positions of that order; any other read, a span of it, in
		// either dialect the driver emits: LIMIT/OFFSET and the SQL:2008 OFFSET ... FETCH form.
		let positions: number[];
		const listed = /IN \((?<list>[\d, ]+)\)/.exec(sql);
		if (sql.includes('ROW_NUMBER()') && listed?.groups) {
			positions = listed.groups.list.split(',').map(Number);
		} else {
			const window = /LIMIT (\d+) OFFSET (\d+)/.exec(sql);
			const fetch = /OFFSET (\d+) ROWS FETCH NEXT (\d+) ROWS ONLY/.exec(sql);
			let offset = 0;
			let limit = this.rowCount;
			if (window) {
				[offset, limit] = [Number(window[2]), Number(window[1])];
			} else if (fetch) {
				[offset, limit] = [Number(fetch[1]), Number(fetch[2])];
			}
			positions = Array.from({ length: Math.max(0, Math.min(limit, this.rowCount - offset)) }, (_, i) => offset + i);
		}
		// Selectors are aliased by request position rather than schema position, so the row has to be
		// keyed the way the caller actually asked for it.
		const selected = [...sql.matchAll(/"(\w+)" AS (c\d+)/g)]
			.map(match => ({ name: match[1], alias: match[2] }));
		return positions.map(position => order[position]).map(id => {
			const row: OdbcRow = {};
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

	async tables(): Promise<OdbcRow[]> { return []; }
	async columns(): Promise<OdbcRow[]> { return []; }
	async primaryKeys(): Promise<OdbcRow[]> { return [{ COLUMN_NAME: 'id', KEY_SEQ: 1 }]; }
}

/** Reads one page of the `id` column through the Data Explorer data path. */
async function readPage(view: OdbcTableView, first: number, count: number): Promise<number[]> {
	const data = await view.getDataValues({
		columns: [{ column_index: 1, spec: { first_index: first, last_index: first + count - 1 } }],
		format_options: FORMAT,
	});
	return data.columns[0].map(Number);
}

/** Pages through the whole table the way scrolling from top to bottom does. */
async function sweep(view: OdbcTableView): Promise<number[]> {
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
 * The paging invariants, run for one dialect and row identity. Every name is shared verbatim with
 * the sibling drivers' paging suites, so `grep` across the drivers shows which of them assert which
 * invariant.
 */
function pagingInvariants(dialect: OdbcDialect, rowIdentity: ReadonlyArray<string>): void {
	const open = () => new OdbcTableView(
		new UnstableOrderClient(ROWS), REF, dialect, SCHEMA, rowIdentity);

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
		// Drop the header row, then read the trailing id column back out of each line.
		const ids = exported.data.trim().split('\n').slice(1)
			.map(line => Number(line.split(',')[1]));

		assert.deepStrictEqual(ids, shown);
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
		const ids = exported.data.trim().split('\n').slice(1)
			.map(line => Number(line.split(',')[1]));

		assert.deepStrictEqual(ids, rows.map(row => shown[row]));
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

/** A client whose SQLPrimaryKeys answer is supplied by the test. */
function keyClient(primaryKeys: OdbcRow[] | 'unsupported'): IOdbcQueryClient {
	return {
		runQuery: async () => [],
		tables: async () => [],
		columns: async () => [],
		primaryKeys: async () => {
			if (primaryKeys === 'unsupported') {
				throw new Error('[odbc] SQLPrimaryKeys is not supported by this driver');
			}
			return primaryKeys;
		},
	};
}

suite('ODBC paging stability', () => {
	suite('resolveOdbcRowIdentity', () => {
		test('returns a composite key in KEY_SEQ order, and nothing where there is no key', async () => {
			const composite = keyClient([
				{ COLUMN_NAME: 'line_no', KEY_SEQ: 2 },
				{ COLUMN_NAME: 'order_id', KEY_SEQ: 1 },
			]);

			assert.deepStrictEqual(
				{
					composite: await resolveOdbcRowIdentity(composite, REF),
					view: await resolveOdbcRowIdentity(composite, { ...REF, kind: 'view' }),
					keyless: await resolveOdbcRowIdentity(keyClient([]), REF),
					unsupported: await resolveOdbcRowIdentity(keyClient('unsupported'), REF),
				},
				{
					composite: ['order_id', 'line_no'],
					view: [],
					keyless: [],
					unsupported: [],
				}
			);
		});
	});

	suite('primary key tiebreaker, LIMIT/OFFSET', () => {
		pagingInvariants(ENFORCED_KEYS, ['id']);
	});

	suite('primary key tiebreaker, OFFSET/FETCH', () => {
		pagingInvariants(ENFORCED_OFFSET_FETCH, ['id']);
	});

	// A composite key appends every column, so paging stays exact even when the leading key column
	// is not unique on its own.
	suite('composite key tiebreaker', () => {
		pagingInvariants(ENFORCED_KEYS, ['status', 'id']);
	});

	// A declared key on a backend that does not enforce keys need not be unique, so it is not paged by.
	suite('unenforced key', () => {
		pagingInvariants(LIMIT_OFFSET, ['id']);

		test('a sweep reads the relation once', async () => {
			const client = new UnstableOrderClient(ROWS);
			await sweep(new OdbcTableView(client, REF, LIMIT_OFFSET, SCHEMA, ['id']));
			assert.strictEqual(client.baseRelationReads, 1);
		});
	});

	// With no key to be had -- a view, a table without one, or a backend that does not enforce keys --
	// rows are read from a result window.
	suite('no row identity, LIMIT/OFFSET', () => {
		pagingInvariants(LIMIT_OFFSET, []);

		test('a sweep reads the relation once', async () => {
			const client = new UnstableOrderClient(ROWS);
			await sweep(new OdbcTableView(client, REF, LIMIT_OFFSET, SCHEMA));
			assert.strictEqual(client.baseRelationReads, 1);
		});

		test('a relation longer than the window serves the window and reports the total', async () => {
			const view = new OdbcTableView(new UnstableOrderClient(RESULT_WINDOW_ROWS + 10), REF, LIMIT_OFFSET, SCHEMA);
			const state: BackendState = await view.getState();
			assert.deepStrictEqual(
				{ rows: state.table_shape.num_rows, total: state.total_num_rows },
				{ rows: RESULT_WINDOW_ROWS, total: RESULT_WINDOW_ROWS + 10 },
			);
		});

		test('a window that cannot be read leaves the view open with its count, and its rows fail', async () => {
			// As a sort on a column the engine cannot order by does: the count runs, the rows do not.
			const client: IOdbcQueryClient = {
				runQuery: async (sql: string) => {
					if (sql.includes('count(*)')) {
						return [{ n: ROWS }];
					}
					throw new Error('cannot read');
				},
				tables: async () => [],
				columns: async () => [],
				primaryKeys: async () => [],
			};
			const view = new OdbcTableView(client, REF, LIMIT_OFFSET, SCHEMA);
			const state = await view.getState();
			await assert.rejects(readPage(view, 0, PAGE), /cannot read/);
			assert.deepStrictEqual(
				{ rows: state.table_shape.num_rows, total: state.total_num_rows },
				{ rows: ROWS, total: undefined },
			);
		});

		test('a relation within the window reports no total', async () => {
			const state = await new OdbcTableView(new UnstableOrderClient(ROWS), REF, LIMIT_OFFSET, SCHEMA).getState();
			assert.deepStrictEqual(
				{ rows: state.table_shape.num_rows, total: state.total_num_rows },
				{ rows: ROWS, total: undefined },
			);
		});

		test('a sort change reads the new order rather than the rows held for the old one', async () => {
			const view = new OdbcTableView(new UnstableOrderClient(ROWS), REF, LIMIT_OFFSET, SCHEMA);
			await readPage(view, 0, PAGE);
			await view.setSortColumns({ sort_keys: [{ column_index: 0, ascending: true }] });
			const statuses = (await view.getDataValues({
				columns: [{ column_index: 0, spec: { first_index: 0, last_index: ROWS - 1 } }],
				format_options: FORMAT,
			})).columns[0];
			assert.deepStrictEqual(statuses, [...statuses].sort());
		});
	});

	// SQL Server rejects OFFSET ... FETCH without an ORDER BY, so an unsorted window orders by the
	// first column, only to make the statement valid.
	suite('no row identity, OFFSET/FETCH', () => {
		pagingInvariants(OFFSET_FETCH, []);
	});
});
