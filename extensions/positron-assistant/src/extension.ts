/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { getModelConfigurations } from './config';
import { newAssistant } from './assistants';

let assistantDisposables: vscode.Disposable[] = [];

function disposeAssistants() {
	assistantDisposables.forEach(d => d.dispose());
	assistantDisposables = [];
}

function registerAssistants(context: vscode.ExtensionContext) {
	// Dispose of existing assistants
	disposeAssistants();

	try {
		const modelConfigs = getModelConfigurations();
		modelConfigs.forEach(config => {
			const assistant = newAssistant(config);
			const disposable = positron.ai.registerAssistant(context.extension, assistant);
			assistantDisposables.push(disposable);
		});
	} catch (e) {
		vscode.window.showErrorMessage(
			`Positron Assistant: Failed to load model configurations - ${e}`
		);
	}
}

export function activate(context: vscode.ExtensionContext) {
	// Register configured assistants
	registerAssistants(context);

	// Listen for configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('positron.assistant.models')) {
				registerAssistants(context);
			}
		})
	);

	context.subscriptions.push({
		dispose: () => disposeAssistants(),
	});
}
