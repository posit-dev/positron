/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PositronRunAppApiImpl } from './api';
import { registerDebugAdapterTrackerFactory } from './debugAdapterTrackerFactory';
import { PositronRunApp } from './positron-run-app';

export const log = vscode.window.createOutputChannel('App Launcher', { log: true });

export enum Config {
	ShellIntegrationEnabled = 'terminal.integrated.shellIntegration.enabled',
	ShowEnableShellIntegrationMessage = 'positron.runApplication.showEnableShellIntegrationMessage',
	ShowShellIntegrationNotSupportedMessage = 'positron.runApplication.showShellIntegrationNotSupportedMessage',
}

export async function activate(context: vscode.ExtensionContext): Promise<PositronRunApp> {
	context.subscriptions.push(log);

	const debugSessionTerminalWatcher = registerDebugAdapterTrackerFactory(context.subscriptions);

	return new PositronRunAppApiImpl(context.globalState, debugSessionTerminalWatcher);
}
