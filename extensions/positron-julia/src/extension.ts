/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { JuliaRuntimeManager } from './runtime-manager';
import { registerCommands } from './commands';
import { PositronSupervisorApi } from './positron-supervisor';

export const LOGGER = vscode.window.createOutputChannel('Julia Language Pack', { log: true });

export function activate(context: vscode.ExtensionContext) {
	const onDidChangeLogLevel = (logLevel: vscode.LogLevel) => {
		LOGGER.appendLine(vscode.l10n.t('Log level: {0}', vscode.LogLevel[logLevel]));
	};
	context.subscriptions.push(LOGGER.onDidChangeLogLevel(onDidChangeLogLevel));
	onDidChangeLogLevel(LOGGER.logLevel);

	// Create and register the Julia runtime manager
	const juliaRuntimeManager = new JuliaRuntimeManager(context);
	positron.runtime.registerLanguageRuntimeManager('julia', juliaRuntimeManager);

	// Register commands
	registerCommands(context, juliaRuntimeManager);

	LOGGER.info('Positron Julia extension activated');
}

export function deactivate() {
	LOGGER.info('Positron Julia extension deactivated');
}

export async function supervisorApi(): Promise<PositronSupervisorApi> {
	const ext = vscode.extensions.getExtension('positron.positron-supervisor');
	if (!ext) {
		throw new Error('Positron Supervisor extension not found');
	}

	if (!ext.isActive) {
		await ext.activate();
	}

	return ext?.exports as PositronSupervisorApi;
}
