/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { createSqliteReadPlan } from '../sqliteReadPlan.js';
import { SqliteRow } from '../sqliteWorkerClient.js';
import { SqliteBindValue } from '../sqliteWorkerProtocol.js';
import { SqliteSchemaEntry, SqliteTableView } from '../sqliteTableView.js';
import { ColumnDisplayType, FormatOptions, TableSelectionKind } from 'positron-data-explorer-protocol';

const FORMAT: FormatOptions = {
	large_num_digits: 2,
	small_num_digits: 4,
	max_integral_digits: 7,
	max_value_length: 100,
};

const SCHEMA: SqliteSchemaEntry[] = [
	{ column_name: 'id', column_type: 'INTEGER', type_display: ColumnDisplayType.Integer },
];

const COLUMNS = SCHEMA.map(c => c.column_name);

const ROW_COUNT = 500;
const PAGE_SIZE = 25;

/**
 * A fake engine that answers only what this suite needs, and that deliberately re-orders any
 * statement whose ORDER BY does not determine a unique order.
 *
 * That re-ordering is not an invention. SQLite returns rows in whatever order the chosen query plan
 * produces, and the plan is free to change between two statements: measured against SQLite 3.51, a
 * paged sweep of a filtered table dropped 60,000 of 250,000 rows and repeated 60,000 others when
 * another connection created an index partway through, because the plan flipped from `SCAN t` to
 * `SEARCH t USING COVERING INDEX`. The fake stands in for that by rotating the rows by one more on
 * each statement, which is the smallest permutation that makes the defect show up: every page
 * boundary then loses exactly one row and repeats another.
 *
 * A statement that states a total order is answered from the canonical order instead, because the
 * engine has no freedom left. So a sweep that comes back exact is a sweep that never relied on
 * unspecified ordering.
 */
class ReorderingEngine {
	readonly queries: string[] = [];
	private _statements = 0;

	/** The canonical order of `id` values, which is what a total ordering must reproduce. */
	private readonly _canonical = Array.from({ length: ROW_COUNT }, (_, i) => i + 1);

	/**
	 * @param _totalOrder The ORDER BY text this engine accepts as a total order.
	 * @param _primaryKey Primary key columns to report from PRAGMA table_info. Supplying them also
	 * makes the `rowid` probe fail, which is how a real WITHOUT ROWID table presents itself.
	 */
	constructor(
		private readonly _totalOrder: string,
		private readonly _primaryKey?: readonly string[],
	) { }

	async runQuery(sql: string, _params?: SqliteBindValue[]): Promise<SqliteRow[]> {
		this.queries.push(sql);
		const flat = sql.replace(/\s+/g, ' ');

		if (flat.startsWith('SELECT rowid FROM')) {
			if (this._primaryKey) {
				throw new Error('no such column: rowid');
			}
			return [];
		}
		if (flat.startsWith('PRAGMA table_info')) {
			return (this._primaryKey ?? []).map((name, i) => ({ name, pk: i + 1 }));
		}
		if (flat.includes('count(*)')) {
			return [{ n: ROW_COUNT }];
		}

		const ordered = this._order(flat);

		// The export path numbers rows with a window function and then filters on those numbers,
		// rather than using LIMIT/OFFSET.
		const rowIndices = /__row_index IN \(([\d, ]+)\)/.exec(flat);
		if (rowIndices) {
			const wanted = rowIndices[1].split(',').map(part => Number(part.trim()));
			return wanted.map(index => ({ c0: ordered[index] }));
		}

		const window = /LIMIT (\d+) OFFSET (\d+)/.exec(flat);
		if (window) {
			const offset = Number(window[2]);
			return ordered.slice(offset, offset + Number(window[1])).map(id => ({ c0: id }));
		}
		return ordered.map(id => ({ c0: id }));
	}

	/**
	 * Returns the rows in the order this statement is entitled to. A statement carrying the total
	 * order gets the canonical order; anything else gets a fresh permutation.
	 */
	private _order(flat: string): number[] {
		this._statements++;
		const orderBy = /ORDER BY (.+?)(?: LIMIT|\)|$)/.exec(flat);
		if (orderBy?.[1].includes(this._totalOrder)) {
			return this._canonical;
		}
		const shift = this._statements % ROW_COUNT;
		return [...this._canonical.slice(shift), ...this._canonical.slice(0, shift)];
	}
}

/** Reads every page in sequence and reports which rows were repeated or never seen. */
async function sweep(view: SqliteTableView): Promise<{ duplicated: number; missing: number }> {
	const seen = new Map<number, number>();
	for (let offset = 0; offset < ROW_COUNT; offset += PAGE_SIZE) {
		const page = await view.getDataValues({
			columns: [{ column_index: 0, spec: { first_index: offset, last_index: offset + PAGE_SIZE - 1 } }],
			format_options: FORMAT,
		});
		for (const value of page.columns[0]) {
			const id = Number(value);
			seen.set(id, (seen.get(id) ?? 0) + 1);
		}
	}
	let duplicated = 0;
	for (const count of seen.values()) {
		duplicated += count - 1;
	}
	return { duplicated, missing: ROW_COUNT - seen.size };
}

suite('SQLite paging Tests', () => {
	test('an unsorted table is paged exactly once per row', async () => {
		// The case the Data Explorer actually opens in: the frontend sends no set_sort_columns until
		// the user sorts, so the very first pages have to carry the tiebreaker on their own.
		const engine = new ReorderingEngine('rowid');
		const plan = await createSqliteReadPlan(engine, 'events', 'table', COLUMNS);
		const view = new SqliteTableView(engine, 'events', plan, SCHEMA);

		assert.deepStrictEqual(await sweep(view), { duplicated: 0, missing: 0 });
	});

	test('the first page already carries the tiebreaker', async () => {
		const engine = new ReorderingEngine('rowid');
		const plan = await createSqliteReadPlan(engine, 'events', 'table', COLUMNS);
		const view = new SqliteTableView(engine, 'events', plan, SCHEMA);

		await view.getDataValues({
			columns: [{ column_index: 0, spec: { first_index: 0, last_index: 9 } }],
			format_options: FORMAT,
		});

		const dataQuery = engine.queries.find(q => q.includes('OFFSET'))!;
		assert.match(dataQuery, /ORDER BY rowid\s+LIMIT 10 OFFSET 0/);
	});

	test('a sorted table is paged exactly once per row', async () => {
		// Sort keys alone are not a total order: rows that tie on the key are still free to move
		// between statements, so the tiebreaker has to survive sorting too.
		const engine = new ReorderingEngine('rowid');
		const plan = await createSqliteReadPlan(engine, 'events', 'table', COLUMNS);
		const view = new SqliteTableView(engine, 'events', plan, SCHEMA);
		await view.setSortColumns({ sort_keys: [{ column_index: 0, ascending: true }] });

		assert.deepStrictEqual(await sweep(view), { duplicated: 0, missing: 0 });
	});

	test('a WITHOUT ROWID table is paged exactly once per row', async () => {
		const engine = new ReorderingEngine('"k"', ['k']);
		const plan = await createSqliteReadPlan(engine, 'kv', 'table', COLUMNS);
		const view = new SqliteTableView(engine, 'kv', plan, SCHEMA);

		assert.deepStrictEqual(await sweep(view), { duplicated: 0, missing: 0 });
	});

	test('a view is paged exactly once per row, from its snapshot', async () => {
		const engine = new ReorderingEngine('rowid');
		const plan = await createSqliteReadPlan(engine, 'sales_by_region', 'view', COLUMNS);
		const view = new SqliteTableView(engine, 'sales_by_region', plan, SCHEMA);

		const result = await sweep(view);
		const snapshots = engine.queries.filter(q => q.startsWith('CREATE TEMP TABLE'));

		assert.deepStrictEqual(
			{ ...result, snapshots: snapshots.length },
			// One snapshot for the whole sweep: the view's own query runs once, not once per page.
			{ duplicated: 0, missing: 0, snapshots: 1 });
	});

	test('the row count and the rows come from the same relation', async () => {
		// The grid's total comes from a separate count(*). When a view is read through a snapshot but
		// counted against the live view, the total can disagree with what the rows add up to.
		const engine = new ReorderingEngine('rowid');
		const plan = await createSqliteReadPlan(engine, 'sales_by_region', 'view', COLUMNS);
		const view = new SqliteTableView(engine, 'sales_by_region', plan, SCHEMA);
		await view.getState();

		const countQuery = engine.queries.find(q => q.includes('count(*)'))!;
		assert.match(countQuery, /FROM temp\."positron_snapshot_\d+"/);
	});

	test('an index-based export returns the rows the grid displayed at those positions', async () => {
		// The half of the defect that leaves a lasting artifact: this path writes a file the user
		// keeps, so a row numbered against a different order than the grid used is silently wrong.
		const engine = new ReorderingEngine('rowid');
		const plan = await createSqliteReadPlan(engine, 'events', 'table', COLUMNS);
		const view = new SqliteTableView(engine, 'events', plan, SCHEMA);

		const positions = [0, 7, 199, 498];
		const displayed: number[] = [];
		for (const position of positions) {
			const page = await view.getDataValues({
				columns: [{ column_index: 0, spec: { first_index: position, last_index: position } }],
				format_options: FORMAT,
			});
			displayed.push(Number(page.columns[0][0]));
		}

		const exported = await view.exportDataSelection({
			selection: { kind: TableSelectionKind.RowIndices, selection: { indices: positions } },
			format: 'csv' as never,
		});
		const exportedIds = exported.data.trim().split('\n').slice(1).map(Number);

		assert.deepStrictEqual(exportedIds, displayed);
	});

	test('generated code names the user\'s relation, not the snapshot', async () => {
		const engine = new ReorderingEngine('rowid');
		const plan = await createSqliteReadPlan(engine, 'sales_by_region', 'view', COLUMNS);
		const view = new SqliteTableView(engine, 'sales_by_region', plan, SCHEMA);

		const code = await view.convertToCode({} as never);

		assert.deepStrictEqual(code.converted_code, ['SELECT *', 'FROM "sales_by_region"']);
	});
});
