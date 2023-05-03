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
import { DataViewerMessage, DataViewerMessageData, DataViewerMessageReady } from './positron-data-viewer';
import { DataModel } from './DataModel';

// This global is injected by VS Code when the extension is loaded.
//
// @ts-ignore
const vscode = acquireVsCodeApi();

// Let the extension know that we're ready to receive data.
const msg: DataViewerMessageReady = {
	msg_type: 'ready'
};
vscode.postMessage(msg);

// Listen for messages from the extension.
window.addEventListener('message', (event: any) => {
	// Presume that the message compiles with the DataViewerMessage interface.
	const message = event.data as DataViewerMessage;

	if (message.msg_type === 'data') {
		const dataMessage = message as DataViewerMessageData;
		const dataModel = new DataModel(dataMessage.data);
		const queryClient = new ReactQuery.QueryClient();
		ReactDOM.render(
			<React.StrictMode>
				<ReactQuery.QueryClientProvider client={queryClient}>
					<DataPanel data={dataModel} />
				</ReactQuery.QueryClientProvider>
			</React.StrictMode>,
			document.getElementById('root')
		);
	} else {
		console.error(`Unknown message type: ${message.msg_type}`);
	}
});
