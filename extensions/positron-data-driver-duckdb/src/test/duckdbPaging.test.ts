/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	DuckDBRow,
	DuckDBSchemaEntry,
	DuckDBTableView,
	createDuckDBReadPlan,
} from 'positron-data-explorer-duckdb';
import { ColumnDisplayType, FormatOptions, TableSelectionKind } from 'positron-data-explorer-protocol';

const FORMAT: FormatOptions = {
	large_num_digits: 2,
	small_num_digits: 4,
	max_integral_digits: 7,
	max_value_length: 100,
};

const SCHEMA: DuckDBSchemaEntry[] = [
	{ column_name: 'id', column_type: 'BIGINT', type_display: ColumnDisplayType.Integer },
];

const COLUMNS = SCHEMA.map(c => c.column_name);

const TABLE_REF = '"main"."events"';
const VIEW_REF = '"main"."sales_by_region"';
const ROW_COUNT = 500;
const PAGE_SIZE = 25;

/**
 * A fake engine modelling the ordering guarantees DuckDB actually gives, measured against DuckDB
 * 1.5.5 and pinned by `preserve_insertion_order` in `duckdbWorker.ts`:
 *
 * - Scanning a base table or a TEMP table returns rows in insertion order, every time, with or
 *   without an ORDER BY. Sweeping 2M rows over 2,000 pages that way repeated and dropped nothing.
 * - Reading a view whose plan is built from hash operators (a join, an aggregate, a DISTINCT, a
 *   window) does not: there is no input order to preserve, so each statement may permute the rows.
 *   Sweeping a 500,000-row join view that way repeated 170,032 rows and missed 170,032 others.
 * - A ROW_NUMBER() window does not inherit the scan's insertion order either. Numbering rows with a
 *   constant window order disagreed with the displayed order on all 171,429 rows of one relation.
 *
 * So this fake permutes exactly the statements DuckDB is entitled to permute, and only those. A
 * sweep that comes back exact is a sweep that never relied on an order DuckDB does not promise.
 */
class DuckDBEngine {
	readonly queries: string[] = [];
	private _statements = 0;

	private readonly _canonical = Array.from({ length: ROW_COUNT }, (_, i) => i + 1);

	async runQuery(sql: string, _params?: Record<string, string>): Promise<DuckDBRow[]> {
		this.queries.push(sql);
		const flat = sql.replace(/\s+/g, ' ');

		if (flat.startsWith('CREATE TEMP TABLE')) {
			return [];
		}
		if (flat.includes('count(*)')) {
			return [{ n: ROW_COUNT }];
		}

		const ordered = this._order(flat);

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

	/** Returns the rows in the order this statement is entitled to see them. */
	private _order(flat: string): number[] {
		this._statements++;

		// A ROW_NUMBER() window is ordered by what is inside its OVER clause, and by nothing else.
		const over = /ROW_NUMBER\(\) OVER \((.*?)\)/.exec(flat);
		if (over) {
			return over[1].includes('rowid') ? this._canonical : this._permuted();
		}

		// Otherwise an explicit total order pins it, and failing that a scan of a table or snapshot
		// still comes back in insertion order. Only reading the view directly is unordered.
		const orderBy = /ORDER BY (.+?)(?: LIMIT|$)/.exec(flat);
		if (orderBy?.[1].includes('rowid')) {
			return this._canonical;
		}
		return flat.includes(VIEW_REF) ? this._permuted() : this._canonical;
	}

	/** The smallest permutation that exposes the defect: one row lost per page boundary. */
	private _permuted(): number[] {
		const shift = this._statements % ROW_COUNT;
		return [...this._canonical.slice(shift), ...this._canonical.slice(0, shift)];
	}
}

/** Reads every page in sequence and reports which rows were repeated or never seen. */
async function sweep(view: DuckDBTableView): Promise<{ duplicated: number; missing: number }> {
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

suite('DuckDB paging Tests', () => {
	test('an unsorted table is paged exactly once per row, without an ORDER BY', async () => {
		// Both halves of this matter. The rows have to be exact, and the paging queries have to stay
		// free of ORDER BY: DuckDB cannot tell that `rowid` order is the scan order it was already
		// going to produce, so adding the clause makes it sort the whole relation on every page --
		// 7.4x over a measured 2M-row sweep -- to buy back an order it never lost.
		const engine = new DuckDBEngine();
		const plan = createDuckDBReadPlan(engine, TABLE_REF, 'table', COLUMNS);
		const view = new DuckDBTableView(engine, TABLE_REF, 'events', plan, SCHEMA);

		const result = await sweep(view);
		const pagingQueries = engine.queries.filter(q => q.includes('OFFSET'));

		assert.deepStrictEqual(
			{ ...result, sortsAnyPage: pagingQueries.some(q => q.includes('ORDER BY')) },
			{ duplicated: 0, missing: 0, sortsAnyPage: false });
	});

	test('a sorted table breaks ties on rowid', async () => {
		// Sort keys alone are not a total order: rows tied on the key are free to move between
		// statements. Here the sort is paid for regardless, so the tiebreaker is nearly free.
		const engine = new DuckDBEngine();
		const plan = createDuckDBReadPlan(engine, TABLE_REF, 'table', COLUMNS);
		const view = new DuckDBTableView(engine, TABLE_REF, 'events', plan, SCHEMA);
		await view.setSortColumns({ sort_keys: [{ column_index: 0, ascending: false }] });

		const result = await sweep(view);
		const dataQuery = engine.queries.find(q => q.includes('OFFSET'))!;

		assert.deepStrictEqual(
			{ ...result, ordersBy: /ORDER BY "id" DESC, rowid/.test(dataQuery) },
			{ duplicated: 0, missing: 0, ordersBy: true });
	});

	test('a view is paged exactly once per row, from a snapshot built once', async () => {
		// Without the snapshot this is the live defect: the view's hash operators give a different
		// permutation per page, and `rowid` does not exist on a view to order by instead.
		const engine = new DuckDBEngine();
		const plan = createDuckDBReadPlan(engine, VIEW_REF, 'view', COLUMNS);
		const view = new DuckDBTableView(engine, VIEW_REF, 'sales_by_region', plan, SCHEMA);

		const result = await sweep(view);
		const snapshots = engine.queries.filter(q => q.startsWith('CREATE TEMP TABLE'));
		const readsView = engine.queries.some(q => q.includes('OFFSET') && q.includes(VIEW_REF));

		assert.deepStrictEqual(
			{ ...result, snapshots: snapshots.length, readsView },
			// One snapshot for the whole sweep, and no page reads the view: its join runs once here,
			// rather than once per page, which is why this is cheaper than reading it directly.
			{ duplicated: 0, missing: 0, snapshots: 1, readsView: false });
	});

	test('the row count and the rows come from the same relation', async () => {
		// The grid's total comes from a separate count(*). Counting the live view while displaying a
		// snapshot would let the total disagree with what the rows add up to.
		const engine = new DuckDBEngine();
		const plan = createDuckDBReadPlan(engine, VIEW_REF, 'view', COLUMNS);
		const view = new DuckDBTableView(engine, VIEW_REF, 'sales_by_region', plan, SCHEMA);
		await view.getState();

		const countQuery = engine.queries.find(q => q.includes('count(*)'))!;
		assert.match(countQuery, /FROM temp\."positron_snapshot_\d+"/);
	});

	test('an index-based export returns the rows the grid displayed at those positions', async () => {
		// The half of the defect that leaves a lasting artifact. This path writes a file the user
		// keeps, and unlike a paging query it cannot leave the order unstated, because a window
		// operator does not inherit the scan order.
		const engine = new DuckDBEngine();
		const plan = createDuckDBReadPlan(engine, TABLE_REF, 'table', COLUMNS);
		const view = new DuckDBTableView(engine, TABLE_REF, 'events', plan, SCHEMA);

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
		const engine = new DuckDBEngine();
		const plan = createDuckDBReadPlan(engine, VIEW_REF, 'view', COLUMNS);
		const view = new DuckDBTableView(engine, VIEW_REF, 'sales_by_region', plan, SCHEMA);
		await view.getState();

		const code = await view.convertToCode({} as never);

		assert.deepStrictEqual(code.converted_code, ['SELECT *', `FROM ${VIEW_REF}`]);
	});
});
