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

export interface DataModelId {
	/**
	 * The row index of the first row in the DataModel.
	 */
	rowStart: number;
	/**
	 * An identifier for the full DataSet.
	 */
	id: string;
}

/**
 * The DataModel class represents the data model behind a DataPanel. It is
 * responsible for loading fragments from the data set as necessary to populate
 * the DataPanel.
 */
export class DataModel {
	constructor(
		public readonly dataSet: DataSet,
		public readonly rowStart = 0) {
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
			rowEnd: Math.min(start + size - 1, this.rowCount - 1),
			columns: columns
		};
	}

	appendDataModel(newData: DataModel): DataModel {
		if (this.dataSet.id !== newData.dataSet.id) {
			throw new Error('Cannot combine DataModels with different ids');
		}
		const currentRowCount = this.dataSet.columns[0].data.length;
		if (this.rowStart + currentRowCount !== newData.rowStart) {
			throw new Error('Cannot combine DataModels with non-contiguous row ranges');
		}
		const combinedData = {
			...this.dataSet,
			columns: this.dataSet.columns.map((column, index) => {
				return {
					...column,
					data: column.data.concat(newData.dataSet.columns[index].data)
				};
			})
		};
		return new DataModel(combinedData, this.rowStart);
	}

	get id(): DataModelId {
		return {
			rowStart: this.rowStart,
			id: this.dataSet.id
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
		if (this.dataSet.rowCount) {
			// Use the complete row count if known
			return this.dataSet.rowCount;
		}
		else if (this.columns.length > 0) {
			// If the row count isn't specified, use the length of the first
			// column
			return this.columns[0].data.length;
		}
		return 0;
	}
}
