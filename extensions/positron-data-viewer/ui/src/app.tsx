/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as ReactDOM from 'react-dom';
import * as React from 'react';

import {
	ColumnDef,
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	Row,
	SortingState,
	useReactTable,
} from '@tanstack/react-table';
import {
	QueryClient,
	QueryClientProvider,
	useInfiniteQuery,
} from '@tanstack/react-query';


import { DataPanel } from './DataPanel';
import { DataColumn, DataSet, DataViewerMessage, DataViewerMessageData, DataViewerMessageReady } from './positron-data-viewer';
import { DataFragment, DataModel } from './DataModel';

// This global is injected by VS Code when the extension is loaded.
//
// @ts-ignore
const vscode = acquireVsCodeApi();

// Let the extension know that we're ready to receive data.
const msg: DataViewerMessageReady = {
	msg_type: 'ready'
};
vscode.postMessage(msg);

function App(dataSet: DataSet) {
	const fetchSize = 100;

	const rerender = React.useReducer(() => ({}), {})[1];
	const tableContainerRef = React.useRef<HTMLDivElement>(null);
	const dataModel = new DataModel(dataSet);

	const columns = React.useMemo<ColumnDef<DataColumn>[]>(
		() => {
			return dataSet.columns.map(column => {
				return {
					accessorKey: column.name,
					header: column.name,
					cell: info => info.getValue(),
				};
			});
		},
		[]);

	//react-query has an useInfiniteQuery hook just for this situation!
	const { data, fetchNextPage, isFetching, isLoading } =
		useInfiniteQuery<DataFragment>(
			['table-data'],
			async ({ pageParam = 0 }) => {
				const start = pageParam * fetchSize;
				const fetchedData = dataModel.loadDataFragment(start, fetchSize);
				return fetchedData;
			},
			{
				getNextPageParam: (_lastGroup, groups) => groups.length,
				keepPreviousData: true,
				refetchOnWindowFocus: false,
			}
		);
}

// Listen for messages from the extension.
window.addEventListener('message', (event: any) => {
	// Presume that the message compiles with the DataViewerMessage interface.
	const message = event.data as DataViewerMessage;

	if (message.msg_type === 'data') {
		const dataMessage = message as DataViewerMessageData;
		ReactDOM.render(
			<DataPanel data={dataMessage.data} />,
			document.getElementById('root')
		);
	} else {
		console.error(`Unknown message type: ${message.msg_type}`);
	}
});
