/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as positron from 'positron';
import { log } from './log.js';
import { clearTokenUsage } from './tokens.js';
import { disposeModels, removeAutoconfiguredModel } from './modelRegistration.js';
import { CopilotService } from './copilot.js';
import { StoredModelConfig, ModelConfig } from './configTypes.js';
import { isAuthExtProvider, resolveApiKey } from './authExtRouting.js';
import { getModelProviders } from './providers/index.js';

export function getStoredModels(context: vscode.ExtensionContext): StoredModelConfig[] {
	return context.globalState.get('positron.assistant.models') || [];
}

export async function getModelConfigurations(context: vscode.ExtensionContext): Promise<ModelConfig[]> {
	const storedConfigs = getStoredModels(context);

	const fullConfigs: ModelConfig[] = await Promise.all(
		storedConfigs.map(async (config) => {
			const apiKey = await resolveApiKey(config, context.secrets);
			return {
				...config,
				apiKey: apiKey || ''
			};
		})
	);

	return fullConfigs;
}

/**
 * Ensure a StoredModelConfig exists in globalState for an auth-ext provider
 * that has an active session. Called when auth sessions change so that model
 * configs survive restarts.
 */
export async function syncSessionToGlobalState(
	context: vscode.ExtensionContext,
	providerId: string,
): Promise<void> {
	let session: vscode.AuthenticationSession | undefined;
	try {
		session = await vscode.authentication.getSession(providerId, [], { silent: true });
	} catch {
		return;
	}
	if (!session) {
		return;
	}

	const providerClass = getModelProviders().find(
		p => p.source.provider.id === providerId
	);
	if (!providerClass) {
		return;
	}

	const existingConfigs: StoredModelConfig[] =
		context.globalState.get('positron.assistant.models') || [];
	const existing = existingConfigs.find(c => c.provider === providerId);
	if (existing) {
		if (existing.id === session.account.id) {
			return;
		}
		// Account ID changed (e.g. user re-saved with a new key). Update it.
		const updated = existingConfigs.map(c =>
			c.provider === providerId
				? { ...c, id: session.account.id }
				: c
		);
		await context.globalState.update('positron.assistant.models', updated);
		log.info(`[Config Sync] Updated stored config for ${providerId} (account ${session.account.id})`);
		return;
	}

	const CONFIG_KEY_OVERRIDES: Record<string, string> = {
		'anthropic-api': 'anthropic',
		'ms-foundry': 'foundry',
	};
	const configKey = CONFIG_KEY_OVERRIDES[providerId] ?? providerId;
	const savedBaseUrl = vscode.workspace
		.getConfiguration(`authentication.${configKey}`)
		.get<string>('baseUrl') || providerClass.source.defaults.baseUrl;

	const newConfig: StoredModelConfig = {
		id: session.account.id,
		provider: providerId,
		type: providerClass.source.type,
		model: providerClass.source.defaults.model,
		baseUrl: savedBaseUrl,
		toolCalls: providerClass.source.defaults.toolCalls,
		completions: providerClass.source.defaults.completions,
	};

	await context.globalState.update(
		'positron.assistant.models',
		[...existingConfigs, newConfig]
	);
	log.info(`[Config Sync] Persisted new config for ${providerId} (account ${session.account.id})`);
}

export async function deleteConfigurationByProvider(context: vscode.ExtensionContext, providerId: string) {
	const existingConfigs: Array<StoredModelConfig> = context.globalState.get('positron.assistant.models') || [];
	const targetConfigs = existingConfigs.filter(config => config.provider === providerId);
	if (targetConfigs.length === 0) {
		// Provider may be autoconfigured and not in persistent state
		// Remove from autoconfigured models list if present
		removeAutoconfiguredModel(providerId);
		return;
	}

	for (const config of targetConfigs) {
		await deleteConfiguration(context, config.id);
	}
}

export async function deleteConfiguration(context: vscode.ExtensionContext, id: string) {
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

	if (!isAuthExtProvider(targetConfig.provider)) {
		await context.secrets.delete(`apiKey-${id}`);
	}

	disposeModels(id);

	clearTokenUsage(targetConfig.provider);

	positron.ai.updateProvider(targetConfig.provider, { signedIn: false });

	// Refresh CopilotService signed-in state if this was a copilot model
	if (targetConfig.provider === 'copilot-auth') {
		try {
			CopilotService.instance().refreshSignedInState();
		} catch (error) {
			// CopilotService might not be initialized yet, which is fine
		}
	}
}

export function logStoredModels(context: vscode.ExtensionContext): void {
	const models = getStoredModels(context);
	const chatModels = models.filter(m => m.type === 'chat').map(m => ({
		model: m.model,
		provider: m.provider,
	}));
	const completionModels = models.filter(m => m.type === 'completion').map(m => ({
		model: m.model,
		provider: m.provider,
	}));
	const modelsInfo = {
		chatModels: chatModels.length > 0 ? chatModels : 'None',
		completionModels: completionModels.length > 0 ? completionModels : 'None',
	};
	log.info('Stored Models:', JSON.stringify(modelsInfo, null, 2));
}
