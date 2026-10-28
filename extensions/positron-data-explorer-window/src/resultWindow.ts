/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ArraySelection,
	ColumnValue,
	DataSelectionCellIndices,
	DataSelectionCellRange,
	DataSelectionIndices,
	DataSelectionRange,
	DataSelectionSingleCell,
	ExportDataSelectionParams,
	ExportedData,
	ExportFormat,
	GetDataValuesParams,
	TableData,
	TableSelectionKind,
} from 'positron-data-explorer-protocol';

/**
 * The most rows a result window holds. A relation with more rows than its window, and no enforced
 * unique key to page by, is served as its leading rows.
 */
export const RESULT_WINDOW_ROWS = 10_000;

/**
 * The most cells a result window holds. Held rows cost about 75 bytes of extension host memory per
 * cell, so this keeps a window near 75 MB however wide the relation is.
 */
export const RESULT_WINDOW_CELLS = 1_000_000;

/** The most rows a result window holds for a relation with the given number of columns. */
export function windowRowLimit(columnCount: number): number {
	return Math.max(1, Math.min(RESULT_WINDOW_ROWS, Math.floor(RESULT_WINDOW_CELLS / Math.max(1, columnCount))));
}

/** The wire encoding of a missing or NULL cell. */
const SENTINEL_NULL = 0;

/** The rows a window holds, and whether the result had more rows than the window could hold. */
export interface HeldRows<Row> {
	readonly rows: readonly Row[];
	readonly truncated: boolean;
}

/**
 * Holds the leading rows of one query result, so that every Data Explorer read of a relation that
 * has no row order of its own is answered from a single statement.
 *
 * Separate statements need not return rows in the same order, so a relation read page by page with
 * LIMIT/OFFSET can repeat some rows and skip others. A single result has a fixed order, so positions
 * within it are stable for as long as it is held.
 *
 * The fetch runs lazily, once per state: the owner calls invalidate() in the same synchronous block
 * that changes the query's sort or filters, and the next read fetches the new state's rows.
 */
export class ResultWindow<Row> {
	private _held: Promise<HeldRows<Row>> | undefined;

	/**
	 * @param _fetch Runs the owner's query for its current state, returning at most `limit` rows.
	 * @param _limit The most rows to hold, read when a fetch starts.
	 */
	constructor(
		private readonly _fetch: (limit: number) => Promise<Row[]>,
		private readonly _limit: () => number,
	) { }

	/** The most rows the window holds for the owner's current state. */
	get limit(): number {
		return this._limit();
	}

	/** Drops the held rows; the next read fetches the owner's current state. */
	invalidate(): void {
		this._held = undefined;
	}

	/**
	 * The held rows, fetching them first if needed. Concurrent reads share one fetch. A failed fetch is
	 * forgotten so the next read tries again, unless the window has moved on to a newer state.
	 */
	rows(): Promise<HeldRows<Row>> {
		if (!this._held) {
			const limit = this._limit();
			// One row past the limit tells a result that exactly fills the window from a longer one.
			const held = this._fetch(limit + 1).then(rows => rows.length > limit ?
				{ rows: rows.slice(0, limit), truncated: true } :
				{ rows, truncated: false });
			this._held = held;
			held.catch(() => {
				if (this._held === held) {
					this._held = undefined;
				}
			});
		}
		return this._held;
	}
}

/**
 * The row counts a windowed view reports. table_shape covers the rows held; total_num_rows is set
 * only when the result had more. The count comes from a separate statement, so it is raised to at
 * least one past the window should the relation have changed in between.
 *
 * With no held rows, because the window's statement failed, the counts are the shape the window would
 * have, taken from the count. The view still opens, and its data requests retry the window and fail
 * on their own, as a page that could not be read always has.
 */
export function windowRowCounts<Row>(held: HeldRows<Row> | undefined, filteredRows: number, limit: number): {
	num_rows: number;
	total_num_rows: number | undefined;
} {
	if (!held) {
		return {
			num_rows: Math.min(filteredRows, limit),
			total_num_rows: filteredRows > limit ? filteredRows : undefined,
		};
	}
	return {
		num_rows: held.rows.length,
		total_num_rows: held.truncated ? Math.max(filteredRows, held.rows.length + 1) : undefined,
	};
}

/**
 * Answers a getDataValues request from held rows. A range is cut off at the last held row; an index
 * past it reads as NULL.
 *
 * @param formatCell Formats one cell of a held row, given the column's index in the view's schema.
 */
export function windowDataValues<Row>(
	params: GetDataValuesParams,
	rows: readonly Row[],
	formatCell: (row: Row, columnIndex: number) => ColumnValue,
): TableData {
	return {
		columns: params.columns.map(column => {
			const format = (rowIndex: number): ColumnValue => {
				const row = rows[rowIndex];
				return row === undefined ? SENTINEL_NULL : formatCell(row, column.column_index);
			};
			const spec = column.spec;
			if (isSelectionRange(spec)) {
				const values: ColumnValue[] = [];
				const lastIndex = Math.min(spec.last_index, rows.length - 1);
				for (let r = spec.first_index; r <= lastIndex; r++) {
					values.push(format(r));
				}
				return values;
			}
			return spec.indices.map(format);
		}),
	};
}

/**
 * Answers an exportDataSelection request from held rows, so an export always contains the rows the
 * grid shows at the selected positions. Positions past the last held row are left out.
 *
 * @param columnNames The view's column names, in schema order.
 * @param exportCell Renders one cell of a held row as export text, given the column's schema index.
 */
export function windowExport<Row>(
	params: ExportDataSelectionParams,
	rows: readonly Row[],
	columnNames: readonly string[],
	exportCell: (row: Row, columnIndex: number) => string,
): ExportedData {
	const allColumns = columnNames.map((_, i) => i);
	const allRows = rows.map((_, i) => i);
	const exportCells = (rowIndices: readonly number[], columnIndices: readonly number[]): ExportedData => {
		const held = rowIndices.map(i => rows[i]).filter((row): row is Row => row !== undefined);
		const matrix = [
			columnIndices.map(c => columnNames[c]),
			...held.map(row => columnIndices.map(c => exportCell(row, c))),
		];
		return { data: formatExport(matrix, params.format), format: params.format };
	};

	switch (params.selection.kind) {
		case TableSelectionKind.SingleCell: {
			const sel = params.selection.selection as DataSelectionSingleCell;
			const row = rows[sel.row_index];
			return { data: row === undefined ? '' : exportCell(row, sel.column_index), format: params.format };
		}
		case TableSelectionKind.CellRange: {
			const sel = params.selection.selection as DataSelectionCellRange;
			return exportCells(
				span(sel.first_row_index, sel.last_row_index),
				span(sel.first_column_index, sel.last_column_index));
		}
		case TableSelectionKind.RowRange: {
			const sel = params.selection.selection as DataSelectionRange;
			return exportCells(span(sel.first_index, sel.last_index), allColumns);
		}
		case TableSelectionKind.ColumnRange: {
			const sel = params.selection.selection as DataSelectionRange;
			return exportCells(allRows, span(sel.first_index, sel.last_index));
		}
		case TableSelectionKind.ColumnIndices: {
			const sel = params.selection.selection as DataSelectionIndices;
			return exportCells(allRows, sel.indices);
		}
		case TableSelectionKind.RowIndices: {
			const sel = params.selection.selection as DataSelectionIndices;
			return exportCells(sel.indices, allColumns);
		}
		case TableSelectionKind.CellIndices: {
			const sel = params.selection.selection as DataSelectionCellIndices;
			return exportCells(sel.row_indices, sel.column_indices);
		}
		default:
			throw new Error(`Unknown selection kind: ${params.selection.kind}`);
	}
}

/** Renders an export matrix (header row + data rows) into the requested format. */
export function formatExport(matrix: string[][], format: ExportFormat): string {
	switch (format) {
		case ExportFormat.Csv:
			return matrix.map(row => row.join(',')).join('\n');
		case ExportFormat.Tsv:
			return matrix.map(row => row.join('\t')).join('\n');
		case ExportFormat.Html:
			return matrix.map(row => `<tr><td>${row.join('</td><td>')}</td></tr>`).join('\n');
		default:
			throw new Error(`Unknown export format: ${format}`);
	}
}

/** Type guard distinguishing a contiguous index range from an explicit index set. */
export function isSelectionRange(spec: ArraySelection): spec is DataSelectionRange {
	return (spec as DataSelectionRange).first_index !== undefined;
}

/** The integers from `first` to `last`, inclusive. */
function span(first: number, last: number): number[] {
	return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
}
