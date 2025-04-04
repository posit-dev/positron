/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as positron from 'positron';
import { randomUUID } from 'crypto';
import { getLanguageModels } from './models';
import { completionModels } from './completion';
import { registerModel, registerModels } from './extension';

export interface StoredModelConfig extends Omit<positron.ai.LanguageModelConfig, 'apiKey'> {
	id: string;
}

/**
 * Interface for storing and retrieving secrets.
 */
export interface SecretStorage {
	store(key: string, value: string): Thenable<void>;
	get(key: string): Thenable<string | undefined>;
	delete(key: string): Thenable<void>;
}

/**
 * Implementation of SecretStorage that uses VS Code's secret storage API.
 *
 * This class should be used in desktop mode to store secrets securely.
 */
export class EncryptedSecretStorage implements SecretStorage {
	constructor(private context: vscode.ExtensionContext) { }
	store(key: string, value: string): Thenable<void> {
		return this.context.secrets.store(key, value);
	}
	get(key: string): Thenable<string | undefined> {
		return this.context.secrets.get(key);
	}
	delete(key: string): Thenable<void> {
		return this.context.secrets.delete(key);
	}
}

/**
 * Implementation of SecretStorage that uses VS Code's global storage API.
 *
 * This class stores secrets **insecurely** using VS Code's global storage API.
 * It is used in web mode, where there is no durable secret storage.
 *
 * This class should be replaced with one that uses a secure storage mechanism,
 * or just removed altogether when Positron gains secure storage capabilities in web mode.
 *
 * https://github.com/rstudio/vscode-server/issues/174
 */
export class GlobalSecretStorage implements SecretStorage {
	constructor(private context: vscode.ExtensionContext) { }
	store(key: string, value: string): Thenable<void> {
		return this.context.globalState.update(key, value);
	}
	get(key: string): Thenable<string | undefined> {
		return Promise.resolve(this.context.globalState.get(key));
	}
	delete(key: string): Thenable<void> {
		return this.context.globalState.update(key, undefined);
	}
}

export interface ModelConfig extends StoredModelConfig {
	apiKey: string;
}

export function getStoredModels(context: vscode.ExtensionContext): StoredModelConfig[] {
	return context.globalState.get('positron.assistant.models') || [];
}

export async function getModelConfiguration(id: string, context: vscode.ExtensionContext, storage: SecretStorage): Promise<ModelConfig | undefined> {
	const storedConfigs = getStoredModels(context);
	const config = storedConfigs.find((config) => config.id === id);

	if (!config) {
		return undefined;
	}

	const apiKey = await storage.get(`apiKey-${config.id}`);
	return {
		...config,
		apiKey: apiKey || ''
	};
}

export async function getModelConfigurations(context: vscode.ExtensionContext, storage: SecretStorage): Promise<ModelConfig[]> {
	const storedConfigs = getStoredModels(context);

	const fullConfigs: ModelConfig[] = await Promise.all(
		storedConfigs.map(async (config) => {
			const apiKey = await storage.get(`apiKey-${config.id}`);
			return {
				...config,
				apiKey: apiKey || ''
			};
		})
	);

	return fullConfigs;
}

export async function showModelList(context: vscode.ExtensionContext, storage: SecretStorage) {
	// Create a quickpick with all configured models
	const modelConfigs = await getModelConfigurations(context, storage);
	const quickPick = vscode.window.createQuickPick();

	// Create sections for chat and completion models
	const chatModels = modelConfigs.filter(config =>
		config.type === 'chat'
	);
	const completionModels = modelConfigs.filter(config =>
		config.type === 'completion'
	);

	const addNewModelLabel = vscode.l10n.t('Add a Language Model');
	const items: Array<vscode.QuickPickItem> = [
		{
			label: vscode.l10n.t('Chat Models'),
			kind: vscode.QuickPickItemKind.Separator
		},
		...chatModels.map((config) => ({
			label: config.name,
			detail: config.model
		})),
		{
			label: vscode.l10n.t('Completion Models'),
			kind: vscode.QuickPickItemKind.Separator
		},
		...completionModels.map((config) => ({
			label: config.name,
			detail: config.model,
			description: config.baseUrl
		})),
		{
			label: '',
			kind: vscode.QuickPickItemKind.Separator
		},
		{
			label: addNewModelLabel,
			description: vscode.l10n.t('Add a new language model configuration'),
		}
	];

	vscode.window.showQuickPick(items, {
		placeHolder: vscode.l10n.t('Remove a language model configuration'),
		canPickMany: false,

	}).then(async (selected) => {
		if (!selected) {
			return;
		}
		if (selected.label === addNewModelLabel) {
			showConfigurationDialog(context, storage);
		} else {
			const selectedConfig = modelConfigs.find((config) => config.name === selected.label);
			if (selectedConfig) {
				confirmModelDeletion(context, storage, selectedConfig);
			}
		}
	});
}

async function confirmModelDeletion(context: vscode.ExtensionContext, storage: SecretStorage, config: ModelConfig) {
	const confirmed = await positron.window.showSimpleModalDialogPrompt(
		vscode.l10n.t('Remove {0}', config.name),
		vscode.l10n.t('Are you sure you want to remove the {0} model {1}?', config.type, config.name),
		vscode.l10n.t('Remove'));

	if (!confirmed) {
		return;
	}

	try {
		await deleteConfiguration(context, storage, config.id);
		vscode.window.showInformationMessage(
			vscode.l10n.t(`Language Model {0} has been removed successfully.`, config.name)
		);
	} catch (err) {
		vscode.window.showErrorMessage(
			vscode.l10n.t(`Failed to remove language model {0}: {1}`, config.name, JSON.stringify(err))
		);
	}
}

export async function getEnabledProviders(): Promise<string[]> {
	// Get the configuration option listing enabled providers
	let enabledProviders: string[] =
		vscode.workspace.getConfiguration('positron.assistant').get('enabledProviders') || [];
	const supportedProviders = await positron.ai.getSupportedProviders();
	enabledProviders.push(...supportedProviders);

	// Ensure an array was specified; coerce other values
	if (!Array.isArray(enabledProviders)) {
		if (typeof enabledProviders === 'string') {
			// Be nice and allow a single string to be used to enable a single provider
			enabledProviders = [enabledProviders];
		} else if (enabledProviders) {
			// Log an error if the value is not a string or array
			console.log('Invalid value for positron.assistant.enabledProviders, ignoring: ',
				JSON.stringify(enabledProviders)
			);
			enabledProviders = [];
		} else {
			enabledProviders = [];
		}
	}

	return enabledProviders;
}

export async function showConfigurationDialog(context: vscode.ExtensionContext, storage: SecretStorage) {

	// Gather model sources; ignore disabled providers
	const enabledProviders = await getEnabledProviders();
	const registeredModels = context.globalState.get<Array<StoredModelConfig>>('positron.assistant.models');
	const sources = [...getLanguageModels(), ...completionModels]
		.map((provider) => {
			const isRegistered = registeredModels?.find((modelConfig) => modelConfig.provider === provider.source.provider.id);
			provider.source.signedIn = !!isRegistered;
			return provider.source;
		})
		.filter((source) => {
			// If no specific set of providers was specified, include all
			return enabledProviders.length === 0 || enabledProviders.includes(source.provider.id);
		});

	// Show a modal asking user for configuration details
	return positron.ai.showLanguageModelConfig(sources, async (userConfig, action) => {
		switch (action) {
			case 'save':
				await saveModel(userConfig, sources, storage, context);
				break;
			case 'delete':
				await deleteConfigurationByProvider(context, storage, userConfig.provider);
				break;
			default:
				throw new Error(vscode.l10n.t('Invalid Language Model action: {0}', action));
		}
	});

}

async function saveModel(userConfig: positron.ai.LanguageModelConfig, sources: positron.ai.LanguageModelSource[], storage: SecretStorage, context: vscode.ExtensionContext) {
	const { name: nameRaw, model: modelRaw, baseUrl: baseUrlRaw, apiKey: apiKeyRaw, ...otherConfig } = userConfig;
	const name = nameRaw.trim();
	const model = modelRaw.trim();
	const baseUrl = baseUrlRaw?.trim();
	const apiKey = apiKeyRaw?.trim();

	// Create unique ID for the configuration
	const id = randomUUID();

	// Check for required fields
	sources
		.filter((source) => source.type === userConfig.type)
		.find((source) => source.provider.id === userConfig.provider)?.supportedOptions
		.forEach((option) => {
			if (!(option in userConfig)) {
				throw new Error(vscode.l10n.t(
					`Can't save configuration with missing required option: ${option}`
				));
			}
		});

	// Store API key in secret storage
	if (apiKey) {
		await storage.store(`apiKey-${id}`, apiKey);
	}

	// Get existing configurations
	const existingConfigs: Array<StoredModelConfig> = context.globalState.get('positron.assistant.models') || [];

	// Add new configuration
	const newConfig: StoredModelConfig = {
		id,
		name,
		model,
		baseUrl,
		...otherConfig,
	};

	// Update global state
	await context.globalState.update(
		'positron.assistant.models',
		[...existingConfigs, newConfig]
	);

	// Register the new model
	try {
		await registerModel(newConfig, context, storage);

		positron.ai.addLanguageModelConfig(expandConfigToSource(newConfig));

		vscode.window.showInformationMessage(
			vscode.l10n.t(`Language Model {0} has been added successfully.`, name)
		);
	} catch (error) {
		await storage.delete(`apiKey-${id}`);
		await context.globalState.update(
			'positron.assistant.models',
			existingConfigs
		);
		const err = error instanceof Error ? error : new Error(JSON.stringify(error));
		throw new Error(vscode.l10n.t(`Failed to add language model {0}: {1}`, name, err.message));
	}
}

async function deleteConfigurationByProvider(context: vscode.ExtensionContext, storage: SecretStorage, providerId: string) {
	const existingConfigs: Array<StoredModelConfig> = context.globalState.get('positron.assistant.models') || [];
	const updatedConfigs = existingConfigs.filter(config => config.provider !== providerId);

	const targetConfig = existingConfigs.find(config => config.provider === providerId);
	if (targetConfig === undefined) {
		throw new Error(vscode.l10n.t('No configuration found for provider {0}', providerId));
	}

	await context.globalState.update(
		'positron.assistant.models',
		updatedConfigs
	);

	await storage.delete(`apiKey-${providerId}`);

	await registerModels(context, storage);

	positron.ai.removeLanguageModelConfig(expandConfigToSource(targetConfig));
}

export function expandConfigToSource(config: StoredModelConfig): positron.ai.LanguageModelSource {
	return {
		...config,
		provider: {
			id: config.provider,
			displayName: config.name
		},
		supportedOptions: [],
		defaults: {
			name: config.name,
			model: config.model
		},
		type: config.type
	};
}

export async function deleteConfiguration(context: vscode.ExtensionContext, storage: SecretStorage, id: string) {
	const existingConfigs: Array<StoredModelConfig> = context.globalState.get('positron.assistant.models') || [];
	const updatedConfigs = existingConfigs.filter(config => config.id !== id);

	await context.globalState.update(
		'positron.assistant.models',
		updatedConfigs
	);

	await storage.delete(`apiKey-${id}`);

	await registerModels(context, storage);
}
