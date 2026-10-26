/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PositronRunAppApiImpl } from './api';

/**
 * Register the commands that let an AI agent see the apps Positron is running
 * and stop them. Their agent metadata is declared in package.json.
 */
export function registerAgentCommands(api: PositronRunAppApiImpl): vscode.Disposable {
	return vscode.Disposable.from(
		vscode.commands.registerCommand('positronRunApp.listApps', () => api.listApps()),
		vscode.commands.registerCommand('positronRunApp.stopApp', (file: unknown) => api.stopApp(toFileUri(file))),
	);
}

/** The app file named by a command argument: a URI, or failing that a path. */
function toFileUri(file: unknown): vscode.Uri {
	if (file instanceof vscode.Uri) {
		return file;
	}
	if (typeof file !== 'string' || !file.trim()) {
		throw new Error('Pass the URI of the app file, as positronRunApp.listApps reports it.');
	}
	// Require a scheme of two or more characters, so a Windows path such as
	// `C:\app.py` is not read as a URI with the scheme `c`.
	return /^[a-zA-Z][\w+.-]+:/.test(file) ? vscode.Uri.parse(file) : vscode.Uri.file(file);
}
