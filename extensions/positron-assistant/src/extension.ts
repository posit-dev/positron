/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { EncryptedSecretStorage, expandConfigToSource, getEnabledProviders, getModelConfiguration, getModelConfigurations, getStoredModels, GlobalSecretStorage, logStoredModels, ModelConfig, SecretStorage, showConfigurationDialog, StoredModelConfig } from './config';
import { createModelConfigsFromEnv, newLanguageModelChatProvider } from './models';
import { registerMappedEditsProvider } from './edits';
import { registerParticipants } from './participants';
import { newCompletionProvider, registerHistoryTracking } from './completion';
import { registerAssistantTools } from './tools.js';
import { registerCopilotService } from './copilot.js';
import { ALL_DOCUMENTS_SELECTOR, DEFAULT_MAX_TOKEN_OUTPUT } from './constants.js';
import { registerCodeActionProvider } from './codeActions.js';
import { generateCommitMessage } from './git.js';
import { TokenTracker } from './tokens.js';
import { exportChatToUserSpecifiedLocation, exportChatToFileInWorkspace } from './export.js';
import { AnthropicLanguageModel } from './anthropic.js';
import { registerParticipantDetectionProvider } from './participantDetection.js';
import { registerAssistantCommands } from './commands/index.js';

const hasChatModelsContextKey = 'positron-assistant.hasChatModels';

let modelDisposables: ModelDisposable[] = [];
let assistantEnabled = false;
let tokenTracker: TokenTracker;

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

		await registerModelWithAPI(modelConfig, context);
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

		// Add any configs that should automatically work when the right environment variables are set
		const modelConfigsFromEnv = createModelConfigsFromEnv();
		// we add in the config if we don't already have it configured
		for (const config of modelConfigsFromEnv) {
			if (!modelConfigs.find(c => c.provider === config.provider)) {
				modelConfigs.push(config);
			}
		}

	} catch (e) {
		const failedMessage = vscode.l10n.t('Positron Assistant: Failed to load model configurations.');
		vscode.window.showErrorMessage(`${failedMessage} ${e}`);
		return;
	}

	const registeredModels: ModelConfig[] = [];
	for (const config of modelConfigs) {
		try {
			await registerModelWithAPI(config, context);
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
 * @param modelConfig the language model's config
 * @param context the extension context
 */
async function registerModelWithAPI(modelConfig: ModelConfig, context: vscode.ExtensionContext) {
	// Register with Language Model API
	if (modelConfig.type === 'chat') {
		// const models = availableModels.get(modelConfig.provider);
		// const modelsCopy = models ? [...models] : [];

		const languageModel = newLanguageModelChatProvider(modelConfig, context);
		const error = await languageModel.resolveConnection(new vscode.CancellationTokenSource().token);

		if (error) {
			throw new Error(error.message);
		}

		const vendor = modelConfig.provider; // as defined in package.json in "languageModels"
		const modelDisp = vscode.lm.registerChatModelProvider(vendor, languageModel);
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

function registerConfigureModelsCommand(context: vscode.ExtensionContext, storage: SecretStorage) {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron-assistant.configureModels', async () => {
			await showConfigurationDialog(context, storage);
		}),
		vscode.commands.registerCommand('positron-assistant.logStoredModels', async () => {
			logStoredModels(context);
			log.show();
		}),
	);
}

function registerGenerateCommitMessageCommand(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron-assistant.generateCommitMessage', () => {
			generateCommitMessage(context);
		})
	);
}

function registerExportChatCommands(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron-assistant.exportChatToFileInWorkspace', async () => {
			await exportChatToFileInWorkspace();
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('positron-assistant.exportChatTo', async () => {
			await exportChatToUserSpecifiedLocation();
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
	registerConfigureModelsCommand(context, storage);
	registerGenerateCommitMessageCommand(context);
	registerExportChatCommands(context);

	// Register mapped edits provider
	registerMappedEditsProvider(context, participantService, log);

	// Register code action provider
	registerCodeActionProvider(context);

	// Register participant detection provider
	registerParticipantDetectionProvider();

	// Register chat commands
	registerAssistantCommands();

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

export function recordTokenUsage(context: vscode.ExtensionContext, provider: string, input: number, output: number) {
	tokenTracker.addTokens(provider, input, output);
}

export function clearTokenUsage(context: vscode.ExtensionContext, provider: string) {
	tokenTracker.clearTokens(provider);
}

// Registry to store token usage by request ID for individual requests
const requestTokenUsage = new Map<string, { inputTokens: number; outputTokens: number; provider: string }>();

export function recordRequestTokenUsage(requestId: string, provider: string, inputTokens: number, outputTokens: number) {
	const enabledProviders = vscode.workspace.getConfiguration('positron.assistant').get('approximateTokenCount', [] as string[]);

	enabledProviders.push(AnthropicLanguageModel.source.provider.id); // ensure anthropicId is always included

	if (!enabledProviders.includes(provider)) {
		return; // Skip if token counting is disabled for this provider
	}

	requestTokenUsage.set(requestId, { inputTokens, outputTokens, provider });
	// Clean up old entries to prevent memory leaks
	setTimeout(() => {
		requestTokenUsage.delete(requestId);
	}, 30000); // Clean up after 30 seconds
}

export function getRequestTokenUsage(requestId: string): { inputTokens: number; outputTokens: number } | undefined {
	return requestTokenUsage.get(requestId);
}

export function activate(context: vscode.ExtensionContext) {
	// Create the log output channel.
	context.subscriptions.push(log);

	const tokenTrackerData = context.workspaceState.get('positron.assistant.tokenCounts');
	tokenTracker = new TokenTracker(context);

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
