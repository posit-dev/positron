/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as positron from 'positron';
import { randomUUID } from 'crypto';
import { languageModels } from './models';
import { completionModels } from './completion';

interface StoredModelConfig extends Omit<positron.ai.LanguageModelConfig, 'apiKey'> {
	id: string;
}

export interface SecretStorage {
	store(key: string, value: string): Thenable<void>;
	get(key: string): Thenable<string | undefined>;
	delete(key: string): Thenable<void>;
}

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
	quickPick.items = [
		...modelConfigs.map((config) => ({
			label: config.name,
			detail: config.model,
			description: config.baseUrl,
		})),
		{
			label: vscode.l10n.t('Add New Model...'),
			description: vscode.l10n.t('Add a new language model configuration'),
		}
	];

	// Show the quickpick
	quickPick.show();
}

export async function showConfigurationDialog(context: vscode.ExtensionContext, storage: SecretStorage) {
	// Gather model sources
	const sources = [...languageModels, ...completionModels].map((provider) => provider.source);

	// Show a modal asking user for configuration details
	return positron.ai.showLanguageModelConfig(sources, async (userConfig) => {
		let { name, model, baseUrl, apiKey, ...otherConfig } = userConfig;
		name = name.trim();
		model = model.trim();
		baseUrl = baseUrl?.trim();
		apiKey = apiKey?.trim();

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

		vscode.window.showInformationMessage(
			vscode.l10n.t(`Language Model {0} has been added successfully.`, name)
		);
	});

}

export async function deleteConfiguration(context: vscode.ExtensionContext, storage: SecretStorage, id: string) {
	const existingConfigs: Array<StoredModelConfig> = context.globalState.get('positron.assistant.models') || [];
	const updatedConfigs = existingConfigs.filter(config => config.id !== id);

	await context.globalState.update(
		'positron.assistant.models',
		updatedConfigs
	);

	await storage.delete(`apiKey-${id}`);
}
