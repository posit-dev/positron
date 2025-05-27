/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PositronRunAppApiImpl } from './api';
import { registerDebugAdapterTrackerFactory } from './debugAdapterTrackerFactory';
import { PositronRunApp } from './positron-run-app';
import { AppLauncherTerminalLinkProvider } from './terminalLinkProvider.js';

export const log = vscode.window.createOutputChannel('App Launcher', { log: true });

export async function activate(context: vscode.ExtensionContext): Promise<PositronRunApp> {
	context.subscriptions.push(log);

	const debugSessionTerminalWatcher = registerDebugAdapterTrackerFactory(context.subscriptions);
	const positronRunApp = new PositronRunAppApiImpl(context.globalState, debugSessionTerminalWatcher);

	context.subscriptions.push(
		vscode.window.registerTerminalLinkProvider(new AppLauncherTerminalLinkProvider(positronRunApp))
	);

	return positronRunApp;
}
