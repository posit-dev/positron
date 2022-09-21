/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { JupyterKernel } from './JupyterKernel';
import { discoverAllKernels } from './JupyterKernelDiscovery';
import { JupyterMessage } from './JupyterMessage';
import { MyriacConsolePanel } from './ConsolePanel';
import { Api } from './Api';

export function activate(context: vscode.ExtensionContext) {

	console.log('Starting Myriac Console extension');
	let api = new Api(context);

	context.subscriptions.push(
		vscode.commands.registerCommand('myriac-console.createConsole', () => {
			api.createConsole();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('myriac-console.restartKernel', () => {
			api.restartKernel();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('myriac-console.shutdownKernel', () => {
			api.shutdownKernel();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('myriac-console.interruptKernel', () => {
			api.interruptKernel();
		})
	);

	context.subscriptions.push(api);

	return api;

	/*
	TODO: for saving/restoring state across VS Code sessions (NYI)

	if (vscode.window.registerWebviewPanelSerializer) {
		vscode.window.registerWebviewPanelSerializer('myriacConsolePanel', {
			async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
				console.log(`NYI - attempting to deserialize from ${state}`);
			}
		});
	}
	*/
}

export function deactivate() {
	console.log('Myriac Console deactivating');
}
