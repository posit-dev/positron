/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DataSet, DataViewerMessageData } from './positron-data-viewer';

export function constructDataViewerMessage(data: DataSet, rowsToFetch = 10): DataViewerMessageData {

	const dataMsg: DataViewerMessageData = {
		msg_type: 'data',
		data: {
			id: data.id,
			title: data.title,
			columns: data.rowCount > rowsToFetch ?
				data.columns.map((column) => {
					return {
						...column,
						data: column.data.slice(0, rowsToFetch)
					};
				}) :
				data.columns,
			rowCount: data.rowCount,
		},
	};
	console.log('dataMsg actual rows: ', dataMsg.data.columns[0].data.length);
	console.log('dataMsg row count: ', dataMsg.data.rowCount);
	return dataMsg;
}
