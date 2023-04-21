/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as ReactDOM from 'react-dom';
import * as React from 'react';

import { DataPanel } from './DataPanel';

// Let the extension know that we're ready to receive data.
window.postMessage({ 'msg_type': 'ready' });

// Listen for messages from the extension.
window.addEventListener('message', (event: any) => {
	if (event.data.msg_type === 'data') {
		ReactDOM.render(
			<DataPanel data={event.data.data} />,
			document.getElementById('root')
		);
	}
});
