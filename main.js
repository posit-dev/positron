/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
	const win = new BrowserWindow({
		width: 800,
		height: 600,
	});
	win.loadURL('data:text/html,<input type=checkbox></input>');
});

app.on('window-all-closed', e => e.preventDefault());
