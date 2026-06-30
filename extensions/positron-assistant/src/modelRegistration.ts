/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { getModelConfigurations } from './config';
import { ModelConfig, StoredModelConfig } from './configTypes.js';
import { newCompletionProvider } from './completion';
import { ALL_DOCUMENTS_SELECTOR } from './constants.js';
import { log } from './log.js';
import { resolveApiKey } from './authExtRouting.js';

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

export async function registerModel(config: StoredModelConfig, context: vscode.ExtensionContext) {
	try {
		const modelConfig: ModelConfig = {
			...config,
			apiKey: undefined // will be filled in below if needed
		};

		const apiKey = await resolveApiKey(modelConfig, context.secrets);
		if (apiKey !== undefined) {
			modelConfig.apiKey = apiKey;
		}

		const enabledProviders = await positron.ai.getEnabledProviders();
		const enabled = enabledProviders.length === 0 || enabledProviders.includes(modelConfig.provider);
		if (!enabled) {
			throw new Error(vscode.l10n.t('Failed to register model configuration. The provider is disabled.'));
		}

		await registerModelWithAPI(modelConfig, context);
	} catch (e) {
		vscode.window.showErrorMessage(
			vscode.l10n.t('Positron Assistant: Failed to register model configuration. {0}', e.message)
		);
		throw e;
	}
}

export async function registerModels(context: vscode.ExtensionContext) {
	// Dispose of existing models
	disposeModels();

	let hasOtherChatModels = false;
	try {
		// Check if there are any other models available (e.g., Copilot)
		const availableModels = await vscode.lm.selectChatModels();
		hasOtherChatModels = availableModels.length > 0;
	} catch (error) {
		log.warn('Failed to check for available language models', error);
	}

	vscode.commands.executeCommand('setContext', hasChatModelsContextKey, hasOtherChatModels);
}

/**
 * Re-register models for a specific provider only.
 * This is more efficient than registerModels(), but only one provider's state changes.
 *
 * When `authProviderId` is provided and no stored or auto-configured models
 * exist, a default config is created from the provider's source metadata
 * if an auth session is available.
 *
 * @param context The extension context
 * @param providerId The provider ID to re-register (e.g., 'snowflake-cortex')
 * @param authProviderId Optional auth provider ID for session-based fallback
 */
export async function registerModelsForProvider(_context: vscode.ExtensionContext, _providerId: string, _authProviderId?: string) {
	// No-op: provider implementations have been removed.
}

/**
 * Registers the language model with the language model API.
 *
 * @param modelConfig the language model's config
 * @param context the extension context
 */
export async function registerModelWithAPI(modelConfig: ModelConfig, _context: vscode.ExtensionContext, instance?: positron.ai.LanguageModelChatProvider<vscode.LanguageModelChatInformation>) {
	if (!instance) {
		throw new Error(`No provider registered for vendor: ${modelConfig.provider}`);
	}

	if (modelConfig.type === 'chat') {
		const error = await instance.resolveConnection(new vscode.CancellationTokenSource().token);
		if (error) {
			throw new Error(error.message);
		}
		const vendor = modelConfig.provider;
		const modelDisp = vscode.lm.registerLanguageModelChatProvider(vendor, instance);
		modelDisposables.push(new ModelDisposable(modelDisp, modelConfig));
		vscode.commands.executeCommand('setContext', hasChatModelsContextKey, true);
	} else if (modelConfig.type === 'completion') {
		const completionProvider = newCompletionProvider(modelConfig);
		const complDisp = vscode.languages.registerInlineCompletionItemProvider(ALL_DOCUMENTS_SELECTOR, completionProvider, { displayName: instance.displayName });
		modelDisposables.push(new ModelDisposable(complDisp, modelConfig));
	}
}
