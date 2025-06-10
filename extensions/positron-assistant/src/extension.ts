/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { EncryptedSecretStorage, expandConfigToSource, getEnabledProviders, getModelConfiguration, getModelConfigurations, getStoredModels, GlobalSecretStorage, ModelConfig, SecretStorage, showConfigurationDialog, showModelList, StoredModelConfig } from './config';
import { availableModels, newLanguageModel } from './models';
import { registerMappedEditsProvider } from './edits';
import { registerParticipants } from './participants';
import { newCompletionProvider, registerHistoryTracking } from './completion';
import { registerAssistantTools } from './tools.js';
import { registerCopilotService } from './copilot.js';
import { ALL_DOCUMENTS_SELECTOR, DEFAULT_MAX_TOKEN_OUTPUT } from './constants.js';
import { registerCodeActionProvider } from './codeActions.js';

const hasChatModelsContextKey = 'positron-assistant.hasChatModels';

let modelDisposables: ModelDisposable[] = [];
let assistantEnabled = false;

/** A chat or completion model provider disposable with associated configuration. */
class ModelDisposable implements vscode.Disposable {
	constructor(
		private readonly _disposable: vscode.Disposable,
		public readonly modelConfig: ModelConfig,
	) { }

	dispose() {
		this._disposable.dispose();
	}
}

/**
 * Dispose chat and/or completion models registered with Positron.
 * @param id If specified, only dispose models with the given ID. Otherwise, dispose all models.
 */
export function disposeModels(id?: string) {
	if (id) {
		// Dispose models with the specified ID i.e. models for the same provider.
		const remainingModelDisposables: ModelDisposable[] = [];
		for (const modelDisposable of modelDisposables) {
			if (modelDisposable.modelConfig.id === id) {
				modelDisposable.dispose();
			} else {
				remainingModelDisposables.push(modelDisposable);
			}
		}
		modelDisposables = remainingModelDisposables;
	} else {
		modelDisposables.forEach(d => d.dispose());
		modelDisposables = [];
	}
}

export const log = vscode.window.createOutputChannel('Assistant', { log: true });

export async function registerModel(config: StoredModelConfig, context: vscode.ExtensionContext, storage: SecretStorage, isDefault: boolean) {
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

		await registerModelWithAPI(modelConfig, context, isDefault);
	} catch (e) {
		vscode.window.showErrorMessage(
			vscode.l10n.t('Positron Assistant: Failed to register model configuration. {0}', [e])
		);
		throw e;
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

	let idx = 0;
	const registeredModels: ModelConfig[] = [];
	for (const config of modelConfigs) {
		try {
			// We need at least one default and one non-default model for the dropdown to appear.
			// For now, just set the first language model as default.
			// TODO: Allow for setting a default in the configuration.
			const isFirst = idx === 0;

			await registerModelWithAPI(config, context, isFirst);
			idx++;
			registeredModels.push(config);
		} catch (e) {
			const failedMessage = vscode.l10n.t('Positron Assistant: Failed to register model configurations.');
			vscode.window.showErrorMessage(`${failedMessage} ${e}`);
		}
	}

	// Set context for if we have chat models available for use
	const hasChatModels = registeredModels.filter(config => config.type === 'chat').length > 0;
	vscode.commands.executeCommand('setContext', hasChatModelsContextKey, hasChatModels);
}

/**
 * Registers the language model with the language model API.
 *
 * @param languageModel the language model to register
 * @param modelConfig the language model's config
 * @param context the extension context
 */
async function registerModelWithAPI(modelConfig: ModelConfig, context: vscode.ExtensionContext, isDefault = false) {
	// Register with Language Model API
	if (modelConfig.type === 'chat') {
		const models = availableModels.get(modelConfig.provider);
		const modelsCopy = models ? [...models] : [];

		const languageModel = newLanguageModel(modelConfig);
		const error = await languageModel.resolveConnection(new vscode.CancellationTokenSource().token);

		if (error) {
			throw new Error(error.message);
		}

		if (modelsCopy.length === 0) {
			// use the default model

			modelsCopy.push({
				name: modelConfig.name,
				identifier: modelConfig.model,
				maxOutputTokens: modelConfig.maxOutputTokens ?? DEFAULT_MAX_TOKEN_OUTPUT,
			});
		}

		for (const model of modelsCopy) {
			const newConfig = {
				...modelConfig,
				model: model.identifier,
				name: model.name,
				maxOutputTokens: model.maxOutputTokens,
			};
			const languageModel = newLanguageModel(newConfig);

			const modelDisp = vscode.lm.registerChatModelProvider(`${languageModel.identifier}-${model.identifier}`, languageModel, {
				name: languageModel.name,
				family: languageModel.provider,
				providerName: languageModel.providerName,
				vendor: context.extension.packageJSON.publisher,
				version: context.extension.packageJSON.version,
				capabilities: languageModel.capabilities,
				maxInputTokens: 0,
				maxOutputTokens: languageModel.maxOutputTokens,
				isUserSelectable: true,
				isDefault: isDefault,
			});
			isDefault = false; // only the first model is default
			modelDisposables.push(new ModelDisposable(modelDisp, newConfig));
			vscode.commands.executeCommand('setContext', hasChatModelsContextKey, true);
		}
	}
	// Register with VS Code completions API
	else if (modelConfig.type === 'completion') {
		const completionProvider = newCompletionProvider(modelConfig);
		// this uses the proposed inlineCompletionAdditions API
		const complDisp = vscode.languages.registerInlineCompletionItemProvider(ALL_DOCUMENTS_SELECTOR, completionProvider, { displayName: modelConfig.name });
		modelDisposables.push(new ModelDisposable(complDisp, modelConfig));
	}
}

function registerAddModelConfigurationCommand(context: vscode.ExtensionContext, storage: SecretStorage) {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron-assistant.addModelConfiguration', async () => {
			await showConfigurationDialog(context, storage);
		})
	);
}

function registerConfigureModelsCommand(context: vscode.ExtensionContext, storage: SecretStorage) {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron-assistant.configureModels', async () => {
			if (vscode.workspace.getConfiguration('positron.assistant').get('newModelConfiguration', true)) {
				// The new model configuration UI lets users sign out of providers as well,
				// so there's no need to show the model list.
				await showConfigurationDialog(context, storage);
			} else {
				await showModelList(context, storage);
			}
		})
	);
}

function registerAssistant(context: vscode.ExtensionContext) {

	// Initialize secret storage. In web mode, we currently need to use global
	// secret storage since encrypted storage is not available.
	const storage = vscode.env.uiKind === vscode.UIKind.Web ?
		new GlobalSecretStorage(context) :
		new EncryptedSecretStorage(context);

	// Register Copilot service
	registerCopilotService(context);

	// Register chat participants
	const participantService = registerParticipants(context);

	// Register configured language models
	registerModels(context, storage);

	// Track opened files for completion context
	registerHistoryTracking(context);

	// Commands
	registerAddModelConfigurationCommand(context, storage);
	registerConfigureModelsCommand(context, storage);

	// Register mapped edits provider
	registerMappedEditsProvider(context, participantService);

	// Register code action provider
	registerCodeActionProvider(context);

	// Dispose cleanup
	context.subscriptions.push({
		dispose: () => {
			disposeModels();
		}
	});

	// Mark the assistant as enabled
	assistantEnabled = true;

	return participantService;
}

export function activate(context: vscode.ExtensionContext) {
	// Create the log output channel.
	context.subscriptions.push(log);

	// Check to see if the assistant is enabled
	const enabled = vscode.workspace.getConfiguration('positron.assistant').get('enable');
	if (enabled) {
		const participantService = registerAssistant(context);
		registerAssistantTools(context, participantService);
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
