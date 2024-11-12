/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { LOGGER } from './extension';
import { RSessionManager } from './session-manager';

export async function registerUriHandler() {
	vscode.window.registerUriHandler({ handleUri });
}

// Example of a URI we expect to handle:
// positron://positron.positron-r/cli?command=x-r-run:testthat::snapshot_review('snap')
//
// How the example URI breaks down:
// {
//    "scheme": "positron",
//    "authority": "positron.positron-r",
//    "path": "/cli",
//    "query": "command=x-r-run:testthat::snapshot_review('zzz')",
//    "fragment": "",
//    "fsPath": "/cli"
// }
function handleUri(uri: vscode.Uri): void {
	if (uri.path !== '/cli') {
		return;
	}

	// Turns this query string
	// "command=x-r-run:testthat::snapshot_review('zzz')"
	// into this object
	// { "command": "x-r-run:testthat::snapshot_review('zzz')" }
	const query = new URLSearchParams(uri.query);
	const command = query.get('command');
	if (!command) {
		return;
	}

	const commandRegex = /^(x-r-(help|run|vignette)):(.+)$/;
	if (!commandRegex.test(command)) {
		return;
	}

	const session = RSessionManager.instance.getConsoleSession();
	if (!session) {
		return;
	}

	session.openResource(command);
	vscode.commands.executeCommand('workbench.panel.positronConsole.focus');
}
