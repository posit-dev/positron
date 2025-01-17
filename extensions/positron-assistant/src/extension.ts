/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { getModelConfigurations, showConfigurationDialog } from './config';
import { newLanguageModel } from './models';
import participants from './participants';
import { newCompletionProvider } from './completion';

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

async function registerModels(context: vscode.ExtensionContext) {
	// Dispose of existing models
	disposeModels();

	try {
		const modelConfigs = await getModelConfigurations(context);
		// Register with Language Model API
		modelConfigs.filter(config => config.type === 'chat').forEach((config, idx) => {
			// We need at least one default and one non-default model for the dropdown to appear.
			// For now, just set the first language model as default.
			const isFirst = idx === 0;

			const languageModel = newLanguageModel(config);
			const modelDisp = vscode.lm.registerChatModelProvider(languageModel.identifier, languageModel, {
				name: languageModel.name,
				family: languageModel.provider,
				vendor: context.extension.packageJSON.publisher,
				version: context.extension.packageJSON.version,
				maxInputTokens: 0,
				maxOutputTokens: 0,
				isUserSelectable: true,
				isDefault: isFirst,
			});
			modelDisposables.push(modelDisp);
		});

		// Register with VS Code completions API
		modelConfigs.filter(config => config.type === 'completion').forEach(config => {
			const completionProvider = newCompletionProvider(config);
			const complDisp = vscode.languages.registerInlineCompletionItemProvider({ pattern: '**/*.*' }, completionProvider);
			modelDisposables.push(complDisp);
		});
	} catch (e) {
		vscode.window.showErrorMessage(
			`Positron Assistant: Failed to load model configurations - ${e}`
		);
	}
}

function registerParticipants() {
	// Register with Positron Assistant API
	Object.keys(participants).forEach(key => {
		positron.ai.registerChatParticipant(participants[key]);
	});
}

export function registerAddModelConfigurationCommand(context: vscode.ExtensionContext) {
	return vscode.commands.registerCommand('positron.assistant.addModelConfiguration', async () => {
		await showConfigurationDialog(context);
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

	context.subscriptions.push(
		registerAddModelConfigurationCommand(context)
	);

	context.subscriptions.push({
		dispose: () => {
			disposeModels();
			disposeParticipants();
		}
	});
}
