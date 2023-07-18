/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DataColumn, DataSet } from './positron-data-viewer';

/**
 * A fragment of data, arranged by column.
 */
export interface DataFragment {
	/**
	 * The row index of the first row in the fragment.
	 */
	rowStart: number;

	/**
	 * The row index of the last row in the fragment.
	 */
	rowEnd: number;

	/**
	 * The rows of data, arranged by column.
	 */
	columns: Array<DataColumn>;
}

/**
 * The DataModel class represents the data model behind a DataPanel. It is
 * responsible for loading fragments from the data set as necessary to populate
 * the DataPanel.
 */
export class DataModel {
	constructor(
		public readonly dataSet: DataSet,
		public readonly rowStart = 0,
		public renderedRows = [0]
	) {
	}

	/**
	 *
	 * @param start The row index of the first row in the fragment.
	 * @param size The number of rows in the fragment.
	 * @returns The fragment of data.
	 */
	loadDataFragment(start: number, size: number): DataFragment {
		const columns = this.dataSet.columns.map((column: DataColumn) => {
			return {
				...column,
				data: column.data.slice(start, start + size)
			};
		});
		return {
			rowStart: start,
			rowEnd: Math.min(start + size - 1, this.rowCount - 1),
			columns: columns
		};
	}

	appendFragment(newFragment: DataFragment): DataModel {
		if (!this.renderedRows.includes(newFragment.rowStart)) {
			this.renderedRows.push(newFragment.rowStart);
			this.renderedRows.sort();
		}

		const columns = this.dataSet.columns.map((column: DataColumn, index: number) => {
			return {
				...column,
				data: column.data.concat(newFragment.columns[index].data)
			};
		});
		const updatedDataModel = new DataModel({
			...this.dataSet,
			columns: columns
		},
			this.rowStart,
			this.renderedRows
		);
		//console.log(`data model has ${updatedDataModel.loadedRowCount} loaded rows out of ${updatedDataModel.rowCount} total rows`);
		return updatedDataModel;
	}

	get id(): String {
		return `
		Rendered rows: ${this.renderedRows}
		Dataset: ${this.dataSet.id}
		`;
	}

	/**
	 * The set of columns in the data set.
	 */
	get columns(): Array<DataColumn> {
		return this.dataSet.columns;
	}

	get loadedRowCount(): number {
		if (this.columns.length > 0) {
			// If the row count isn't specified, use the length of the first
			// column
			return this.columns[0].data.length;
		}
		return 0;
	}

	get rowEnd(): number {
		return Math.min(this.rowStart + this.loadedRowCount - 1, this.rowCount - 1);
	}

	/**
	 * The number of rows in the data set.
	 */
	get rowCount(): number {
		if (this.dataSet.rowCount) {
			// Use the complete row count if known
			return this.dataSet.rowCount;
		}
		return this.loadedRowCount;
	}
}
