/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { getModelConfigurations } from './config';
import { newLanguageModel } from './models';
import participants from './participants';

let modelDisposables: vscode.Disposable[] = [];
let participantDisposables: vscode.Disposable[] = [];

function disposeModels() {
	modelDisposables.forEach(d => d.dispose());
	modelDisposables = [];
}

function disposeParticipants() {
	participantDisposables.forEach(d => d.dispose());
	participantDisposables = [];
}

function registerModels(context: vscode.ExtensionContext) {
	// Dispose of existing models
	disposeModels();

	try {
		const modelConfigs = getModelConfigurations();
		modelConfigs.forEach(config => {
			const languageModel = newLanguageModel(config);
			const disposable = positron.ai.registerLanguageModel(languageModel);
			modelDisposables.push(disposable);
		});
	} catch (e) {
		vscode.window.showErrorMessage(
			`Positron Assistant: Failed to load model configurations - ${e}`
		);
	}
}

function registerParticipants() {
	Object.keys(participants).forEach(key => {
		positron.ai.registerChatParticipant(participants[key]);
	});
}

export function activate(context: vscode.ExtensionContext) {
	// Register chat participants
	registerParticipants();

	// Register configured language models
	registerModels(context);

	// Listen for configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('positron.assistant.models')) {
				registerModels(context);
			}
		})
	);

	context.subscriptions.push({
		dispose: () => {
			disposeModels();
			disposeParticipants();
		}
	});
}
