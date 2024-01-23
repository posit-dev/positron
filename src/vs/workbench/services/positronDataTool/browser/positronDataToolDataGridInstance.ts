/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DataGridInstance } from 'vs/base/browser/ui/dataGrid/classes/dataGridInstance';

interface Row {
	columns: Map<number, string>;
}

/**
 * PositronDataToolDataGridInstance class.
 */
export class PositronDataToolDataGridInstance extends DataGridInstance {

	private _rowCache = new Map<number, Row>();

	/**
	 * Gets the number of rows.
	 */
	get rows() {
		return 1_000_000;
	}

	/**
	 * Gets a cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns The cell.
	 */
	cell(columnIndex: number, rowIndex: number): string | undefined {
		// See if the row is in the row cache.
		const row = this._rowCache.get(rowIndex);
		if (row === undefined) {

			this._rowCache.set(rowIndex, {
				columns: new Map<number, string>()
			});

			setTimeout(() => {
				const columns = new Map<number, string>();
				for (let i = 0; i < this.columns; i++) {
					columns.set(i, `Row ${rowIndex} Col ${i}`);
				}
				this._rowCache.set(rowIndex, {
					columns
				});

				this._onDidUpdateEmitter.fire();
			}, 250);

			return undefined;
		} else {
			return row.columns.get(columnIndex);
		}
	}
}
