/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DataSet, DataViewerMessageData } from './positron-data-viewer';

function sliceData(data: DataSet, start: number, size: number): DataSet {
	if (start < 0 || start >= data.rowCount) {
		throw new Error(`Invalid start index: ${start}`);
	} else if (data.rowCount <= size) {
		return data;
	}

	const columns = data.columns.map((column) => {
		return {
			...column,
			data: column.data.slice(start, start + size)
		};
	});
	return {
		id: data.id,
		title: data.title,
		columns: columns,
		rowCount: data.rowCount
	};
}

export function constructDataViewerMessage(data: DataSet, startRow: number, rowsToFetch = 10): DataViewerMessageData {

	const dataMsg: DataViewerMessageData = {
		msg_type: startRow === 0 ? 'initial_data' : 'receive_rows',
		start_row: startRow,
		fetch_size: rowsToFetch,
		data: sliceData(data, startRow, rowsToFetch)
	};
	return dataMsg;
}
