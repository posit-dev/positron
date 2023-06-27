/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// External libraries.
import * as ReactDOM from 'react-dom';
import * as React from 'react';

// External modules.
import * as ReactQuery from '@tanstack/react-query';

// Local modules.
import { DataPanel } from './DataPanel';

// External types.
import { DataViewerMessage, DataViewerMessageData, DataViewerMessageRequest } from './positron-data-viewer';
import { DataModel } from './DataModel';

// This global is injected by VS Code when the extension is loaded.
//
// @ts-ignore
const vscode = acquireVsCodeApi();
// Let the extension know that we're ready to receive the initial data.
const msg: DataViewerMessageRequest = {
	msg_type: 'ready',
	start_row: 0,
	fetch_size: 10
};
vscode.postMessage(msg);

// Listen for messages from the extension.
window.addEventListener('message', (event: any) => {
	// Presume that the message compiles with the DataViewerMessage interface.
	const message = event.data as DataViewerMessage;

	if (message.msg_type === 'initial_data') {
		const dataMessage = message as DataViewerMessageData;
		const dataModel = new DataModel(dataMessage.data);
		const numRowsReceived = dataMessage.data.columns[0].data.length;
		console.log(`DATA: Received initial data: from ${dataMessage.start_row} to ${dataMessage.start_row + numRowsReceived}`);
		console.log(`DATA: Row ${dataMessage.start_row} starts with ${dataMessage.data.columns[0].data[0]}`);

		const queryClient = new ReactQuery.QueryClient();
		ReactDOM.render(
			<React.StrictMode>
				<ReactQuery.QueryClientProvider client={queryClient}>
					<DataPanel data={dataModel} vscode={vscode}/>
				</ReactQuery.QueryClientProvider>
			</React.StrictMode>,
			document.getElementById('root')
		);
	}
});
