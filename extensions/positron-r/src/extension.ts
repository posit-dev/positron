/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { registerCommands } from './commands';
import { registerFormatter } from './formatting';
import { providePackageTasks } from './tasks';
import { setContexts } from './contexts';
import { setupTestExplorer, refreshTestExplorer } from './testing/testing';
import { RRuntimeProvider, rRuntimeDiscoverer } from './provider';


export const Logger = vscode.window.createOutputChannel('Positron R Extension', { log: true });

export function activate(context: vscode.ExtensionContext) {
	const onDidChangeLogLevel = (logLevel: vscode.LogLevel) => {
		Logger.appendLine(vscode.l10n.t('Log level: {0}', vscode.LogLevel[logLevel]));
	};
	context.subscriptions.push(Logger.onDidChangeLogLevel(onDidChangeLogLevel));
	onDidChangeLogLevel(Logger.logLevel);

	positron.runtime.registerLanguageRuntimeProvider('r', new RRuntimeProvider(context));

	positron.runtime.registerLanguageRuntimeDiscoverer(
		'r', rRuntimeDiscoverer(context));

	// Set contexts.
	setContexts(context);

	// Register commands.
	registerCommands(context);

	// Register formatter.
	registerFormatter(context);

	// Provide tasks.
	providePackageTasks(context);

	// Setup testthat test explorer.
	setupTestExplorer(context);
	vscode.workspace.onDidChangeConfiguration(async event => {
		if (event.affectsConfiguration('positron.r.testing')) {
			refreshTestExplorer(context);
		}
	});
}
