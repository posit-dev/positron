/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { EncryptedSecretStorage, expandConfigToSource, getEnabledProviders, getModelConfiguration, getModelConfigurations, getStoredModels, GlobalSecretStorage, ModelConfig, SecretStorage, showConfigurationDialog, showModelList, StoredModelConfig } from './config';
import { newLanguageModel } from './models';
import { newCompletionProvider, registerHistoryTracking } from './completion';
import { editsProvider } from './edits';
import { createParticipants } from './participants';

const hasChatModelsContextKey = 'positron-assistant.hasChatModels';

let modelDisposables: vscode.Disposable[] = [];
let participantDisposables: vscode.Disposable[] = [];
let assistantEnabled = false;

function disposeModels() {
	modelDisposables.forEach(d => d.dispose());
	modelDisposables = [];
}

function disposeParticipants() {
	participantDisposables.forEach(d => d.dispose());
	participantDisposables = [];
}

export async function registerModel(config: StoredModelConfig, context: vscode.ExtensionContext, storage: SecretStorage) {
	try {
		const modelConfig = await getModelConfiguration(config.id, context, storage);

		if (!modelConfig) {
			vscode.window.showErrorMessage(
				vscode.l10n.t('Positron Assistant: Failed to register model configuration. The model configuration could not be found.')
			);
			throw new Error(vscode.l10n.t('Failed to register model configuration. The model configuration could not be found.'));
		}

		const enabledProviders = await getEnabledProviders();
		const enabled = enabledProviders.length === 0 || enabledProviders.includes(modelConfig.provider);
		if (!enabled) {
			vscode.window.showErrorMessage(
				vscode.l10n.t('Positron Assistant: Failed to register model configuration. The provider is disabled.')
			);
			throw new Error(vscode.l10n.t('Failed to register model configuration. The provider is disabled.'));
		}

		const languageModel = newLanguageModel(modelConfig);
		const error = await languageModel.resolveConnection(new vscode.CancellationTokenSource().token);

		if (error) {
			vscode.window.showErrorMessage(
				vscode.l10n.t(`Positron Assistant: Failed to register model configuration. ${error.message}`)
			);
			throw new Error(vscode.l10n.t('Failed to register model configuration. {0}', [error.message]));
		}

		registerModelWithAPI(languageModel, modelConfig, context);
	} catch (e) {
		vscode.window.showErrorMessage(
			vscode.l10n.t('Positron Assistant: Failed to register model configuration. {0}', [e])
		);
		throw new Error(vscode.l10n.t('Failed to register model configuration. {0}', [e]));
	}
}

export async function registerModels(context: vscode.ExtensionContext, storage: SecretStorage) {
	// Dispose of existing models
	disposeModels();

	let modelConfigs: ModelConfig[] = [];
	try {
		// Refresh the set of enabled providers
		const enabledProviders = await getEnabledProviders();
		modelConfigs = await getModelConfigurations(context, storage);
		modelConfigs = modelConfigs.filter(config => {
			const enabled = enabledProviders.length === 0 ||
				enabledProviders.includes(config.provider);
			if (!enabled) {
				console.log('Ignoring disabled model provider: ', config.provider);
			}
			return enabled;
		});
	} catch (e) {
		const failedMessage = vscode.l10n.t('Positron Assistant: Failed to load model configurations.');
		vscode.window.showErrorMessage(`${failedMessage} ${e}`);
		return;
	}

	try {
		modelConfigs
			.forEach((config, idx) => {
				// We need at least one default and one non-default model for the dropdown to appear.
				// For now, just set the first language model as default.
				// TODO: Allow for setting a default in the configuration.
				const isFirst = idx === 0;

				const languageModel = newLanguageModel(config);
				registerModelWithAPI(languageModel, config, context, isFirst);
			});

		// Set context for if we have chat models available for use
		const hasChatModels = modelConfigs.filter(config => config.type === 'chat').length > 0;
		vscode.commands.executeCommand('setContext', hasChatModelsContextKey, hasChatModels);

	} catch (e) {
		const failedMessage = vscode.l10n.t('Positron Assistant: Failed to register model configurations.');
		vscode.window.showErrorMessage(`${failedMessage} ${e}`);
	}
}

/**
 * Registers the language model with the language model API.
 *
 * @param languageModel the language model to register
 * @param modelConfig the language model's config
 * @param context the extension context
 */
function registerModelWithAPI(languageModel: positron.ai.LanguageModelChatProvider, modelConfig: ModelConfig, context: vscode.ExtensionContext, isDefault = true) {
	// Register with Language Model API
	if (modelConfig.type === 'chat') {
		const modelDisp = vscode.lm.registerChatModelProvider(languageModel.identifier, languageModel, {
			name: languageModel.name,
			family: languageModel.provider,
			vendor: context.extension.packageJSON.publisher,
			version: context.extension.packageJSON.version,
			maxInputTokens: 0,
			maxOutputTokens: 0,
			isUserSelectable: true,
			isDefault: isDefault,
		});
		modelDisposables.push(modelDisp);
	}

	// Register with VS Code completions API
	if (modelConfig.type === 'completion') {
		const completionProvider = newCompletionProvider(modelConfig);
		const complDisp = vscode.languages.registerInlineCompletionItemProvider({ pattern: '**/*.*' }, completionProvider);
		modelDisposables.push(complDisp);
	}

	const hasChatModels = modelConfig.type === 'chat';
	vscode.commands.executeCommand('setContext', hasChatModelsContextKey, hasChatModels);
}

function registerParticipants(context: vscode.ExtensionContext) {
	const participants = createParticipants(context);
	Object.keys(participants).forEach(async (key) => {
		// Register agent with Positron Assistant API
		// Note: This is an alternative to a `package.json` definition that allows dynamic commands
		const disposable = await positron.ai.registerChatAgent(participants[key].agentData);
		context.subscriptions.push(disposable);

		// Register agent implementation with the vscode API
		const participant = vscode.chat.createChatParticipant(participants[key].id, participants[key].requestHandler);
		participant.iconPath = participants[key].iconPath;
		participant.followupProvider = participants[key].followupProvider;
		participant.welcomeMessageProvider = participants[key].welcomeMessageProvider;
	});
}

function registerAddModelConfigurationCommand(context: vscode.ExtensionContext, storage: SecretStorage) {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron-assistant.addModelConfiguration', () => {
			showConfigurationDialog(context, storage);
		})
	);
}

function registerConfigureModelsCommand(context: vscode.ExtensionContext, storage: SecretStorage) {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron-assistant.configureModels', () => {
			showModelList(context, storage);
		})
	);
}

function registerMappedEditsProvider(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.chat.registerMappedEditsProvider({ pattern: '**/*' }, editsProvider)
	);
}

function registerAssistant(context: vscode.ExtensionContext) {

	// Initialize secret storage. In web mode, we currently need to use global
	// secret storage since encrypted storage is not available.
	const storage = vscode.env.uiKind === vscode.UIKind.Web ?
		new GlobalSecretStorage(context) :
		new EncryptedSecretStorage(context);

	// Register chat participants
	registerParticipants(context);

	// Register configured language models
	registerModels(context, storage);

	// Track opened files for completion context
	registerHistoryTracking(context);

	// Commands
	registerAddModelConfigurationCommand(context, storage);
	registerConfigureModelsCommand(context, storage);

	// Register mapped edits provider
	registerMappedEditsProvider(context);

	// Dispose cleanup
	context.subscriptions.push({
		dispose: () => {
			disposeModels();
			disposeParticipants();
		}
	});

	// Mark the assistant as enabled
	assistantEnabled = true;
}

export function activate(context: vscode.ExtensionContext) {
	// Check to see if the assistant is enabled
	const enabled = vscode.workspace.getConfiguration('positron.assistant').get('enable');
	if (enabled) {
		registerAssistant(context);
		const storedModels = getStoredModels(context);
		if (storedModels.length) {
			storedModels.forEach(stored => {
				positron.ai.addLanguageModelConfig(expandConfigToSource(stored));
			});
		}
	} else {
		// If the assistant is not enabled, listen for configuration changes so that we can
		// enable it immediately if the user enables it in the settings.
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('positron.assistant.enable')) {
					const enabled =
						vscode.workspace.getConfiguration('positron.assistant').get('enable');
					if (enabled && !assistantEnabled) {
						try {
							registerAssistant(context);
							vscode.window.showInformationMessage(
								vscode.l10n.t('Positron Assistant is now enabled.')
							);
						} catch (e) {
							vscode.window.showErrorMessage(
								vscode.l10n.t(
									'Positron Assistant: Failed to enable assistant. {0}', [e]));
						}
					}
				}
			}));
	}
}
