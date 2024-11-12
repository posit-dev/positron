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

function handleUri(uri: vscode.Uri): void {
	LOGGER.info(`handleUri called with URI: ${uri.toString(true)}`);
	//vscode.window.showInformationMessage(`handleUri called with URI: ${uri.toString(true)}`);

	if (uri.path !== '/cli') {
		return;
	}

	const queryParams = new URLSearchParams(uri.query);
	const queryParamsObject: { [key: string]: string } = {};
	queryParams.forEach((value, key) => {
		queryParamsObject[key] = value;
	});

	const uriDetails = {
		scheme: uri.scheme,
		authority: uri.authority,
		path: uri.path,
		query: uri.query,
		queryParams: queryParamsObject,
		fragment: uri.fragment,
		fsPath: uri.fsPath
	};

	const uriDetailsJson = JSON.stringify(uriDetails, null, 2);
	vscode.window.showInformationMessage(`URI Details:\n${uriDetailsJson}`);

	if (!queryParams.has('command')) {
		return;
	}
	const command = queryParams.get('command');
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
