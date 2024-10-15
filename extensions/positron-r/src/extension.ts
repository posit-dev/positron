/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { registerCommands } from './commands';
import { registerFormatter } from './formatting';
import { providePackageTasks } from './tasks';
import { setContexts } from './contexts';
import { setupTestExplorer, refreshTestExplorer } from './testing/testing';
import { RRuntimeManager } from './runtime-manager';
import { RSessionManager } from './session-manager';

export const LOGGER = vscode.window.createOutputChannel('Positron R Extension', { log: true });

export function activate(context: vscode.ExtensionContext) {
	const onDidChangeLogLevel = (logLevel: vscode.LogLevel) => {
		LOGGER.appendLine(vscode.l10n.t('Log level: {0}', vscode.LogLevel[logLevel]));
	};
	context.subscriptions.push(LOGGER.onDidChangeLogLevel(onDidChangeLogLevel));
	onDidChangeLogLevel(LOGGER.logLevel);

	positron.runtime.registerLanguageRuntimeManager(new RRuntimeManager(context));

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

	// Listen for terminal output
	const disposable = vscode.window.onDidWriteTerminalData(event => {
		processTerminalOutput(event.data);
	});
	context.subscriptions.push(disposable);

	context.subscriptions.push(
		vscode.window.registerUriHandler({
			handleUri
		})
	);
}

function processTerminalOutput(data: string) {
	//console.log(`Full data string: ${data}`);
	const regex = /\u001b]8;;x-r-run:(.*?)\u0007(.*?)\u001b]8;;\u0007/g;
	let match;
	while ((match = regex.exec(data)) !== null) {
		const command = match[1];
		const text = match[2];
		console.log(`Detected OSC hyperlink - command: ${command}, text: ${text}`);
	}
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
