/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { createAutomaticModelConfigs, newLanguageModelChatProvider } from './providers';
import { getModelConfigurations } from './config';
import { ModelConfig, SecretStorage, StoredModelConfig } from './configTypes.js';
import { newCompletionProvider } from './completion';
import { ALL_DOCUMENTS_SELECTOR } from './constants.js';
import { AssistantError } from './extension';
import { log } from './log.js';

const hasChatModelsContextKey = 'positron-assistant.hasChatModels';

let modelDisposables: ModelDisposable[] = [];

const autoconfiguredModels: ModelConfig[] = [];

/**
 * Add a model to the autoconfigured models list.
 * @param config The model configuration to add
 */
export function addAutoconfiguredModel(config: ModelConfig): void {
	// Check if model already exists (by id or provider)
	const existingIndex = autoconfiguredModels.findIndex(
		c => c.id === config.id || c.provider === config.provider
	);
	if (existingIndex === -1) {
		autoconfiguredModels.push(config);
	}
}

/**
 * Remove a model from the autoconfigured models list by provider.
 * @param providerId The provider ID to remove
 */
export function removeAutoconfiguredModel(providerId: string): void {
	const index = autoconfiguredModels.findIndex(c => c.provider === providerId);
	if (index !== -1) {
		autoconfiguredModels.splice(index, 1);
	}
}

/**
 * Get all models which were automatically configured (e.g., via environment variables or managed credentials).
 * @returns A list of models that were automatically configured
 */
export function getAutoconfiguredModels(): ModelConfig[] {
	return [...autoconfiguredModels];
}

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

export async function registerModel(config: StoredModelConfig, context: vscode.ExtensionContext, storage: SecretStorage) {
	try {
		const modelConfig: ModelConfig = {
			...config,
			apiKey: undefined // will be filled in below if needed
		};

		const apiKey = await storage.get(`apiKey-${modelConfig.id}`);
		if (apiKey) {
			modelConfig.apiKey = apiKey;
		}

		if (!modelConfig) {
			vscode.window.showErrorMessage(
				vscode.l10n.t('Positron Assistant: Failed to register model configuration. The model configuration could not be found.')
			);
			throw new Error(vscode.l10n.t('Failed to register model configuration. The model configuration could not be found.'));
		}

		const enabledProviders = await positron.ai.getEnabledProviders();
		const enabled = enabledProviders.length === 0 || enabledProviders.includes(modelConfig.provider);
		if (!enabled) {
			vscode.window.showErrorMessage(
				vscode.l10n.t('Positron Assistant: Failed to register model configuration. The provider is disabled.')
			);
			throw new Error(vscode.l10n.t('Failed to register model configuration. The provider is disabled.'));
		}

		await registerModelWithAPI(modelConfig, context, storage);
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

	let autoModelConfigs: ModelConfig[];
	let modelConfigs: ModelConfig[] = [];
	try {
		// Refresh the set of enabled providers
		const enabledProviders = await positron.ai.getEnabledProviders();

		modelConfigs = await getModelConfigurations(context, storage);
		modelConfigs = modelConfigs.filter(config => {
			const enabled = enabledProviders.length === 0 ||
				enabledProviders.includes(config.provider);
			if (!enabled) {
				console.log('Ignoring disabled model provider: ', config.provider);
			}
			return enabled;
		});

		// Add any configs that should automatically work when the right conditions are met
		autoModelConfigs = await createAutomaticModelConfigs();
		// we add in the config if we don't already have it configured
		for (const config of autoModelConfigs) {
			if (!modelConfigs.find(c => c.provider === config.provider)) {
				modelConfigs.push(config);
			}
		}

	} catch (e) {
		if (!(e instanceof AssistantError) || e.display) {
			const failedMessage = vscode.l10n.t('Positron Assistant: Failed to load model configurations.');
			vscode.window.showErrorMessage(`${failedMessage} ${e}`);
		}

		return;
	}

	const registeredModels: ModelConfig[] = [];
	for (const config of modelConfigs) {
		try {
			await registerModelWithAPI(config, context, storage);
			registeredModels.push(config);
			if (autoModelConfigs.includes(config)) {
				// In addition, track auto-configured models separately
				// at a module level so that we can expose them via
				// getAutoconfiguredModels()
				// This is needed since auto-configured models are not
				// stored in persistent storage like manually configured models
				// are, and configuration data needs to be retrieved from memory.
				autoconfiguredModels.push(config);
			}
		} catch (e) {
			if (!(e instanceof AssistantError) || e.display) {
				vscode.window.showErrorMessage(`${e}`);
			}
		}
	}

	// Set context for if we have chat models available for use
	// Check both Positron-registered models and other language models (e.g., Copilot)
	const hasPositronChatModels = registeredModels.filter(config => config.type === 'chat').length > 0;
	let hasOtherChatModels = false;

	try {
		// Check if there are any other models available (e.g., Copilot)
		const availableModels = await vscode.lm.selectChatModels();
		hasOtherChatModels = availableModels.length > 0;
	} catch (error) {
		log.warn('Failed to check for available language models', error);
	}

	const hasChatModels = hasPositronChatModels || hasOtherChatModels;
	vscode.commands.executeCommand('setContext', hasChatModelsContextKey, hasChatModels);
}

/**
 * Registers the language model with the language model API.
 *
 * @param modelConfig the language model's config
 * @param context the extension context
 */
export async function registerModelWithAPI(modelConfig: ModelConfig, context: vscode.ExtensionContext, storage: SecretStorage, instance?: positron.ai.LanguageModelChatProvider<vscode.LanguageModelChatInformation>) {
	// Register with Language Model API
	if (modelConfig.type === 'chat') {
		// const models = availableModels.get(modelConfig.provider);
		// const modelsCopy = models ? [...models] : [];

		const languageModel = instance ?? newLanguageModelChatProvider(modelConfig, context, storage);

		try {
			const error = await languageModel.resolveConnection(new vscode.CancellationTokenSource().token);

			if (error) {
				throw new Error(error.message);
			}
		} catch (error) {
			// Handle both patterns: models that throw errors directly (like ErrorLanguageModel and OpenAILanguageModel)
			// and models that return errors (like the base AILanguageModel)
			throw error;
		}

		const vendor = modelConfig.provider; // as defined in package.json in "languageModels"
		const modelDisp = vscode.lm.registerLanguageModelChatProvider(vendor, languageModel);
		modelDisposables.push(new ModelDisposable(modelDisp, modelConfig));
		vscode.commands.executeCommand('setContext', hasChatModelsContextKey, true);
	}
	// Register with VS Code completions API
	else if (modelConfig.type === 'completion') {
		const completionProvider = newCompletionProvider(modelConfig);
		// this uses the proposed inlineCompletionAdditions API
		const complDisp = vscode.languages.registerInlineCompletionItemProvider(ALL_DOCUMENTS_SELECTOR, completionProvider, { displayName: modelConfig.name });
		modelDisposables.push(new ModelDisposable(complDisp, modelConfig));
	}
}
