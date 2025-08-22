/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as positron from 'positron';
import { randomUUID } from 'crypto';
import { getLanguageModels } from './models';
import { completionModels } from './completion';
import { clearTokenUsage, disposeModels, log, registerModel } from './extension';
import { CopilotService } from './copilot.js';

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
		})
		.map((source) => {
			// Resolve environment variables in apiKeyEnvVar
			if ('apiKeyEnvVar' in source.defaults && source.defaults.apiKeyEnvVar) {
				const envVarName = (source.defaults as any).apiKeyEnvVar.key;
				const envVarValue = process.env[envVarName];

				source = {
					...source,
					defaults: {
						...source.defaults,
						apiKeyEnvVar: { key: envVarName, signedIn: !!envVarValue }
					},
				};
			}
			return source;
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
			case 'oauth-signin':
				await oauthSignin(userConfig, sources, storage, context);
				break;
			case 'oauth-signout':
				await oauthSignout(userConfig, sources, storage, context);
				break;
			case 'cancel':
				// User cancelled the dialog, clean up any pending operations
				CopilotService.instance().cancelCurrentOperation();
				break;
			default:
				throw new Error(vscode.l10n.t('Invalid Language Model action: {0}', action));
		}
	});

}

async function saveModel(userConfig: positron.ai.LanguageModelConfig, sources: positron.ai.LanguageModelSource[], storage: SecretStorage, context: vscode.ExtensionContext) {
	const { name: nameRaw, model: modelRaw, baseUrl: baseUrlRaw, apiKey: apiKeyRaw, oauth: oauth, ...otherConfig } = userConfig;
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
	const targetConfig = existingConfigs.find(config => config.provider === providerId);
	if (targetConfig === undefined) {
		throw new Error(vscode.l10n.t('No configuration found for provider {0}', providerId));
	}
	await deleteConfiguration(context, storage, targetConfig.id);
}

async function oauthSignin(userConfig: positron.ai.LanguageModelConfig, sources: positron.ai.LanguageModelSource[], storage: SecretStorage, context: vscode.ExtensionContext) {
	try {
		switch (userConfig.provider) {
			case 'copilot':
				await CopilotService.instance().signIn();
				break;
			default:
				throw new Error(vscode.l10n.t('OAuth sign-in is not supported for provider {0}', userConfig.provider));
		}

		await saveModel(userConfig, sources, storage, context);
	} catch (error) {
		if (error instanceof vscode.CancellationError) {
			return;
		}

		const err = error instanceof Error ? error : new Error(JSON.stringify(error));
		throw new Error(vscode.l10n.t(`Failed to sign in to provider {0}: {1}`, userConfig.provider, err.message));
	}
}

async function oauthSignout(userConfig: positron.ai.LanguageModelConfig, sources: positron.ai.LanguageModelSource[], storage: SecretStorage, context: vscode.ExtensionContext) {
	let oauthCompleted = false;
	try {
		switch (userConfig.provider) {
			case 'copilot':
				oauthCompleted = await CopilotService.instance().signOut();
				break;
			default:
				throw new Error(vscode.l10n.t('OAuth sign-out is not supported for provider {0}', userConfig.provider));
		}

		if (oauthCompleted) {
			await deleteConfigurationByProvider(context, storage, userConfig.provider);
		} else {
			throw new Error(vscode.l10n.t('OAuth sign-out was not completed successfully.'));
		}

	} catch (error) {
		const err = error instanceof Error ? error : new Error(JSON.stringify(error));
		throw new Error(vscode.l10n.t(`Failed to sign out of provider {0}: {1}`, userConfig.provider, err.message));
	}

}

/**
 * Note: the LanguageModelSource object returned by this function is not the same as the original
 * one that was used to create the configuration.
 */
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

	const targetConfig = existingConfigs.find(config => config.id === id);
	if (targetConfig === undefined) {
		throw new Error(vscode.l10n.t('No configuration found with ID {0}', id));
	}

	await context.globalState.update(
		'positron.assistant.models',
		updatedConfigs
	);

	await storage.delete(`apiKey-${id}`);

	disposeModels(id);

	clearTokenUsage(context, targetConfig.provider);

	positron.ai.removeLanguageModelConfig(expandConfigToSource(targetConfig));
}

export function logStoredModels(context: vscode.ExtensionContext): void {
	const models = getStoredModels(context);
	const chatModels = models.filter(m => m.type === 'chat').map(m => ({
		name: m.name,
		model: m.model,
		provider: m.provider,
	}));
	const completionModels = models.filter(m => m.type === 'completion').map(m => ({
		name: m.name,
		model: m.model,
		provider: m.provider,
	}));
	const modelsInfo = {
		chatModels: chatModels.length > 0 ? chatModels : 'None',
		completionModels: completionModels.length > 0 ? completionModels : 'None',
	};
	log.info('Stored Models:', JSON.stringify(modelsInfo, null, 2));
}
