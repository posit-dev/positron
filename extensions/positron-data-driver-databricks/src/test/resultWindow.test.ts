/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Covers positron-data-explorer-window, which the server Data Explorer drivers share. The tests live
// in this extension's suite because a build-time-only package has no suite of its own, and this one
// already runs in CI (scripts/test-integration.sh).

import * as assert from 'assert';
import { ExportFormat, FormatOptions, TableSelectionKind } from 'positron-data-explorer-protocol';
import { RESULT_WINDOW_CELLS, RESULT_WINDOW_ROWS, ResultWindow, windowDataValues, windowExport, windowRowCounts, windowRowLimit } from 'positron-data-explorer-window';

type Row = { id: number; name: string };

const FORMAT: FormatOptions = {
	large_num_digits: 2,
	small_num_digits: 4,
	max_integral_digits: 7,
	max_value_length: 1000,
	thousands_sep: '',
};

const rowsOf = (count: number): Row[] => Array.from({ length: count }, (_, id) => ({ id, name: `r${id}` }));

/** A fetch that answers from a fixed set of rows, honoring the limit, and counts its calls. */
function fixedFetch(rows: Row[]) {
	const calls: number[] = [];
	return {
		calls,
		fetch: async (limit: number) => {
			calls.push(limit);
			return rows.slice(0, limit);
		},
	};
}

/** A fetch whose calls stay pending until the test settles them, in order. */
function deferredFetch() {
	const pending: Array<{ resolve: (rows: Row[]) => void; reject: (error: Error) => void }> = [];
	return {
		pending,
		fetch: (_limit: number) => new Promise<Row[]>((resolve, reject) => pending.push({ resolve, reject })),
	};
}

/** Lets pending promise callbacks run. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

suite('Shared Result Window', () => {
	suite('ResultWindow', () => {
		test('a result that fits is held whole and not marked truncated', async () => {
			const source = fixedFetch(rowsOf(3));
			const held = await new ResultWindow(source.fetch, () => 5).rows();
			assert.deepStrictEqual({ ids: held.rows.map(r => r.id), truncated: held.truncated, calls: source.calls },
				{ ids: [0, 1, 2], truncated: false, calls: [6] });
		});

		test('a result that exactly fills the window is not marked truncated', async () => {
			const held = await new ResultWindow(fixedFetch(rowsOf(5)).fetch, () => 5).rows();
			assert.deepStrictEqual({ count: held.rows.length, truncated: held.truncated }, { count: 5, truncated: false });
		});

		test('a longer result is cut to the window and marked truncated', async () => {
			const held = await new ResultWindow(fixedFetch(rowsOf(9)).fetch, () => 5).rows();
			assert.deepStrictEqual({ ids: held.rows.map(r => r.id), truncated: held.truncated },
				{ ids: [0, 1, 2, 3, 4], truncated: true });
		});

		test('concurrent reads share one fetch, and later reads reuse it', async () => {
			const source = fixedFetch(rowsOf(3));
			const window = new ResultWindow(source.fetch, () => 5);
			const [a, b] = await Promise.all([window.rows(), window.rows()]);
			await window.rows();
			assert.deepStrictEqual({ same: a === b, calls: source.calls.length }, { same: true, calls: 1 });
		});

		test('invalidate makes the next read fetch the new state', async () => {
			let state = 'first';
			const window = new ResultWindow(async () => [{ id: 0, name: state }], () => 5);
			const before = await window.rows();
			state = 'second';
			window.invalidate();
			const after = await window.rows();
			assert.deepStrictEqual([before.rows[0].name, after.rows[0].name], ['first', 'second']);
		});

		test('a fetch superseded while in flight is never served to a later read', async () => {
			const source = deferredFetch();
			const window = new ResultWindow(source.fetch, () => 5);
			const stale = window.rows();
			window.invalidate();
			const fresh = window.rows();
			// The superseded fetch finishes last; the read made after the change still gets its own.
			source.pending[1].resolve([{ id: 2, name: 'fresh' }]);
			source.pending[0].resolve([{ id: 1, name: 'stale' }]);
			assert.deepStrictEqual(
				[(await stale).rows[0].name, (await fresh).rows[0].name, (await window.rows()).rows[0].name],
				['stale', 'fresh', 'fresh']);
		});

		test('a failed fetch is retried by the next read', async () => {
			let fail = true;
			const window = new ResultWindow(async () => {
				if (fail) {
					throw new Error('timed out');
				}
				return rowsOf(2);
			}, () => 5);
			await assert.rejects(window.rows(), /timed out/);
			fail = false;
			assert.strictEqual((await window.rows()).rows.length, 2);
		});

		test('a superseded fetch that fails does not discard the newer state\'s rows', async () => {
			const source = deferredFetch();
			const window = new ResultWindow(source.fetch, () => 5);
			const stale = window.rows();
			window.invalidate();
			const fresh = window.rows();
			source.pending[1].resolve(rowsOf(1));
			await fresh;
			source.pending[0].reject(new Error('cancelled'));
			await assert.rejects(stale, /cancelled/);
			await settle();
			// Still answered from the newer fetch, without a third one.
			assert.deepStrictEqual({ count: (await window.rows()).rows.length, fetches: source.pending.length },
				{ count: 1, fetches: 2 });
		});
	});

	suite('windowRowLimit', () => {
		test('holds the full row count for a narrow relation and fewer rows as it widens', () => {
			assert.deepStrictEqual(
				[1, 12, 100, 101, 500, 2_000_000].map(windowRowLimit),
				[RESULT_WINDOW_ROWS, RESULT_WINDOW_ROWS, RESULT_WINDOW_ROWS, Math.floor(RESULT_WINDOW_CELLS / 101), 2_000, 1],
			);
		});

		test('treats a relation with no columns as one column wide', () => {
			assert.strictEqual(windowRowLimit(0), RESULT_WINDOW_ROWS);
		});
	});

	suite('windowRowCounts', () => {
		test('reports a whole result as itself, with no total', () => {
			assert.deepStrictEqual(windowRowCounts({ rows: rowsOf(3), truncated: false }, 3, 5),
				{ num_rows: 3, total_num_rows: undefined });
		});

		test('reports a truncated result as the window plus the counted total', () => {
			assert.deepStrictEqual(windowRowCounts({ rows: rowsOf(5), truncated: true }, 1000, 5),
				{ num_rows: 5, total_num_rows: 1000 });
		});

		test('never reports a total that is not more than the window', () => {
			// The count ran as a separate statement, before rows were added to the relation.
			assert.deepStrictEqual(windowRowCounts({ rows: rowsOf(5), truncated: true }, 4, 5),
				{ num_rows: 5, total_num_rows: 6 });
		});

		test('reports the shape the window would have when it could not be read', () => {
			assert.deepStrictEqual(
				[windowRowCounts(undefined, 3, 5), windowRowCounts(undefined, 1000, 5)],
				[{ num_rows: 3, total_num_rows: undefined }, { num_rows: 5, total_num_rows: 1000 }]);
		});
	});

	suite('windowDataValues', () => {
		const format = (row: Row, columnIndex: number) => columnIndex === 0 ? String(row.id) : row.name;

		test('answers ranges and index sets from the held rows, by schema column', () => {
			const data = windowDataValues({
				columns: [
					{ column_index: 1, spec: { first_index: 1, last_index: 2 } },
					{ column_index: 0, spec: { indices: [3, 0] } },
				],
				format_options: FORMAT,
			}, rowsOf(4), format);
			assert.deepStrictEqual(data.columns, [['r1', 'r2'], ['3', '0']]);
		});

		test('cuts a range at the last held row and reads an index past it as NULL', () => {
			const data = windowDataValues({
				columns: [
					{ column_index: 0, spec: { first_index: 1, last_index: 10 } },
					{ column_index: 0, spec: { indices: [1, 10] } },
				],
				format_options: FORMAT,
			}, rowsOf(3), format);
			assert.deepStrictEqual(data.columns, [['1', '2'], ['1', 0]]);
		});
	});

	suite('windowExport', () => {
		const names = ['id', 'name'];
		const cell = (row: Row, columnIndex: number) => columnIndex === 0 ? String(row.id) : row.name;
		const exportAs = (kind: TableSelectionKind, selection: object) =>
			windowExport({ selection: { kind, selection } as never, format: ExportFormat.Csv }, rowsOf(4), names, cell).data;

		test('every selection kind exports the held rows at the selected positions', () => {
			assert.deepStrictEqual({
				singleCell: exportAs(TableSelectionKind.SingleCell, { row_index: 2, column_index: 1 }),
				cellRange: exportAs(TableSelectionKind.CellRange,
					{ first_row_index: 1, last_row_index: 2, first_column_index: 0, last_column_index: 0 }),
				rowRange: exportAs(TableSelectionKind.RowRange, { first_index: 3, last_index: 3 }),
				columnRange: exportAs(TableSelectionKind.ColumnRange, { first_index: 1, last_index: 1 }),
				columnIndices: exportAs(TableSelectionKind.ColumnIndices, { indices: [0] }),
				rowIndices: exportAs(TableSelectionKind.RowIndices, { indices: [2, 0] }),
				cellIndices: exportAs(TableSelectionKind.CellIndices, { row_indices: [3, 1], column_indices: [1, 0] }),
			}, {
				singleCell: 'r2',
				cellRange: 'id\n1\n2',
				rowRange: 'id,name\n3,r3',
				columnRange: 'name\nr0\nr1\nr2\nr3',
				columnIndices: 'id\n0\n1\n2\n3',
				rowIndices: 'id,name\n2,r2\n0,r0',
				cellIndices: 'name,id\nr3,3\nr1,1',
			});
		});

		test('positions past the last held row are left out', () => {
			assert.deepStrictEqual({
				singleCell: exportAs(TableSelectionKind.SingleCell, { row_index: 9, column_index: 0 }),
				rowRange: exportAs(TableSelectionKind.RowRange, { first_index: 3, last_index: 9 }),
				cellIndices: exportAs(TableSelectionKind.CellIndices, { row_indices: [9, 0], column_indices: [0] }),
			}, {
				singleCell: '',
				rowRange: 'id,name\n3,r3',
				cellIndices: 'id\n0',
			});
		});

		test('renders each export format', () => {
			const exportIn = (format: ExportFormat) => windowExport({
				selection: { kind: TableSelectionKind.RowRange, selection: { first_index: 0, last_index: 0 } },
				format,
			}, rowsOf(1), names, cell).data;
			assert.deepStrictEqual([exportIn(ExportFormat.Csv), exportIn(ExportFormat.Tsv), exportIn(ExportFormat.Html)],
				['id,name\n0,r0', 'id\tname\n0\tr0', '<tr><td>id</td><td>name</td></tr>\n<tr><td>0</td><td>r0</td></tr>']);
		});
	});
});
