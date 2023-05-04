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
	columns: Array<Array<any>>;
}

/**
 * The DataModel class represents the data model behind a DataPanel. It is
 * responsible for loading fragments from the data set as necessary to populate
 * the DataPanel.
 */
export class DataModel {
	constructor(public readonly dataSet: DataSet) {
	}

	/**
	 *
	 * @param start The row index of the first row in the fragment.
	 * @param size The number of rows in the fragment.
	 * @returns The fragment of data.
	 */
	loadDataFragment(start: number, size: number): DataFragment {
		const columns = this.dataSet.columns.map((column: DataColumn) => {
			return column.data.slice(start, start + size);
		});
		return {
			rowStart: start,
			rowEnd: start + size - 1,
			columns: columns
		};
	}

	/**
	 * The set of columns in the data set.
	 */
	get columns(): Array<DataColumn> {
		return this.dataSet.columns;
	}

	/**
	 * The number of rows in the data set.
	 */
	get rowCount(): number {
		return this.dataSet.rowCount;
	}
}
