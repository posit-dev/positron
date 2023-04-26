/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as ReactDOM from 'react-dom';
import * as React from 'react';

import { DataPanel } from './DataPanel';
import { DataColumn } from '../../src/positron-data-viewer';

// This global is injected by VS Code when the extension is loaded.
//
// @ts-ignore
const vscode = acquireVsCodeApi();

// Let the extension know that we're ready to receive data.
console.log('Sending ready message to extension...');
vscode.postMessage({ 'msg_type': 'ready' });

// Listen for messages from the extension.
window.addEventListener('message', (event: any) => {
	console.log('Received message from extension: ' + JSON.stringify(event));
	if (event.data.msg_type === 'data') {
		const cols = event.data.data as Array<DataColumn>;
		ReactDOM.render(
			<DataPanel data={cols} />,
			document.getElementById('root')
		);
	}
});
