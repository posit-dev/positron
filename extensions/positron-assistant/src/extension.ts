/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { expandConfigToSource, getEnabledProviders, getModelConfiguration, getModelConfigurations, getStoredModels, logStoredModels, ModelConfig, showConfigurationDialog, StoredModelConfig } from './config';
import { createAutomaticModelConfigs, newLanguageModelChatProvider } from './providers';
import { registerMappedEditsProvider } from './edits';
import { ParticipantService, registerParticipants } from './participants';
import { newCompletionProvider, registerHistoryTracking } from './completion';
import { registerAssistantTools } from './tools.js';
import { registerCopilotService } from './copilot.js';
import { ALL_DOCUMENTS_SELECTOR, DEFAULT_MAX_TOKEN_OUTPUT } from './constants.js';
import { registerCodeActionProvider } from './codeActions.js';
import { generateCommitMessage } from './git.js';
import { generateNotebookSuggestions, type NotebookActionSuggestion, type NotebookSuggestionsResult } from './notebookSuggestions.js';
import { TokenUsage, TokenTracker } from './tokens.js';
import { exportChatToUserSpecifiedLocation, exportChatToFileInWorkspace } from './export.js';
import { AnthropicModelProvider } from './providers/anthropic/anthropicProvider.js';
import { registerParticipantDetectionProvider } from './participantDetection.js';
import { registerAssistantCommands } from './commands/index.js';
import { PositronAssistantApi } from './api.js';
import { registerPromptManagement } from './promptRender.js';
import { collectDiagnostics } from './diagnostics.js';
import { BufferedLogOutputChannel } from './logBuffer.js';
import { resetAssistantState } from './reset.js';
import { verifyProvidersInCustomModels } from './modelDefinitions.js';

const hasChatModelsContextKey = 'positron-assistant.hasChatModels';

// (Authentication provider is registered via registerCopilotAuthProvider)

let modelDisposables: ModelDisposable[] = [];
let assistantEnabled = false;
let tokenTracker: TokenTracker;

const autoconfiguredModels: ModelConfig[] = [];

/**
 * Get all models which were automatically configured (e.g., via environment variables or managed credentials).
 * @returns A list of models that were automatically configured
 */
export function getAutoconfiguredModels(): ModelConfig[] {
	return [...autoconfiguredModels];
}

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
 * An error thrown by the assistant that can optionally be displayed to the user.
 */
export class AssistantError extends Error {
	constructor(message: string, public readonly display: boolean = true) {
		super(message);
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

export const log = new BufferedLogOutputChannel(
	vscode.window.createOutputChannel('Assistant', { log: true })
);

export async function registerModel(config: StoredModelConfig, context: vscode.ExtensionContext) {
	try {
		const modelConfig: ModelConfig = {
			...config,
			apiKey: undefined // will be filled in below if needed
		};

		const apiKey = await context.secrets.get(`apiKey-${modelConfig.id}`);
		if (apiKey) {
			modelConfig.apiKey = apiKey;
		}

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

export async function registerModels(context: vscode.ExtensionContext) {
	// Dispose of existing models
	disposeModels();

	let autoModelConfigs: ModelConfig[];
	let modelConfigs: ModelConfig[] = [];
	try {
		// Refresh the set of enabled providers
		const enabledProviders = await getEnabledProviders();

		modelConfigs = await getModelConfigurations(context);
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
			await registerModelWithAPI(config, context);
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
export async function registerModelWithAPI(modelConfig: ModelConfig, context: vscode.ExtensionContext, instance?: positron.ai.LanguageModelChatProvider<vscode.LanguageModelChatInformation>) {
	// Register with Language Model API
	if (modelConfig.type === 'chat') {
		// const models = availableModels.get(modelConfig.provider);
		// const modelsCopy = models ? [...models] : [];

		const languageModel = instance ?? newLanguageModelChatProvider(modelConfig, context);

		try {
			const error = await languageModel.resolveConnection(new vscode.CancellationTokenSource().token);

			if (error) {
				throw new Error(error.message);
			}
		} catch (error) {
			// Handle both patterns: models that throw errors directly (like ErrorModelProvider and OpenAIModelProvider)
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

function registerConfigureModelsCommand(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron-assistant.configureModels', async () => {
			await showConfigurationDialog(context);
		}),
		vscode.commands.registerCommand('positron-assistant.logStoredModels', async () => {
			logStoredModels(context);
			log.show();
		}),
	);
}

function registerGenerateCommitMessageCommand(
	context: vscode.ExtensionContext,
	participantService: ParticipantService,
	log: vscode.LogOutputChannel,
) {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron-assistant.generateCommitMessage', () => {
			generateCommitMessage(context, participantService, log);
		})
	);
}

function registerGenerateNotebookSuggestionsCommand(
	context: vscode.ExtensionContext,
	participantService: ParticipantService,
	log: vscode.LogOutputChannel,
) {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positron-assistant.generateNotebookSuggestions',
			async (notebookUri: string, progressCallbackCommand?: string, token?: vscode.CancellationToken): Promise<NotebookSuggestionsResult> => {
				// Create a token source only if no token is provided
				let tokenSource: vscode.CancellationTokenSource | undefined;
				const cancellationToken = token || (tokenSource = new vscode.CancellationTokenSource()).token;
				try {
					return await generateNotebookSuggestions(
						notebookUri,
						participantService,
						log,
						cancellationToken,
						progressCallbackCommand
					);
				} finally {
					// Only dispose if we created the token
					tokenSource?.dispose();
				}
			}
		)
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

function registerToggleInlineCompletionsCommand(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron-assistant.toggleInlineCompletions', async () => {
			await toggleInlineCompletions();
		})
	);
}

function registerCollectDiagnosticsCommand(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron-assistant.collectDiagnostics', async () => {
			await collectDiagnostics(context, log);
		})
	);
}

function registerResetCommand(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron-assistant.resetState', async () => {
			await resetAssistantState(context);
		})
	);
}

async function toggleInlineCompletions() {
	// Get the current value of the setting
	const config = vscode.workspace.getConfiguration('positron.assistant');
	const currentSettings = config.get<Record<string, boolean>>('inlineCompletions.enable') || {};

	// Get the current file's language ID if there's an active text editor
	const activeEditor = vscode.window.activeTextEditor;
	const currentLanguageId = activeEditor?.document.languageId;

	let keyToToggle: string;
	let currentValue: boolean;

	if (currentLanguageId && (currentLanguageId in currentSettings)) {
		// If current file type has an explicit setting, toggle it
		keyToToggle = currentLanguageId;
		currentValue = currentSettings[currentLanguageId];
	} else {
		// Otherwise toggle the global setting (*)
		keyToToggle = '*';
		currentValue = currentSettings['*'] ?? true; // Default to true if not set
	}

	// Toggle the value
	const newValue = !currentValue;
	const updatedSettings = { ...currentSettings };
	updatedSettings[keyToToggle] = newValue;

	// Update the configuration
	await config.update('inlineCompletions.enable', updatedSettings, vscode.ConfigurationTarget.Global);
}

function registerAssistant(context: vscode.ExtensionContext) {

	// Register Copilot service
	registerCopilotService(context);

	// Register chat participants
	const participantService = registerParticipants(context);

	// Register configured language models
	registerModels(context);

	// Track opened files for completion context
	registerHistoryTracking(context);

	// Commands
	registerConfigureModelsCommand(context);
	registerGenerateCommitMessageCommand(context, participantService, log);
	registerGenerateNotebookSuggestionsCommand(context, participantService, log);
	registerExportChatCommands(context);
	registerToggleInlineCompletionsCommand(context);
	registerCollectDiagnosticsCommand(context);
	registerResetCommand(context);
	registerPromptManagement(context);

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

export function recordTokenUsage(context: vscode.ExtensionContext, provider: string, tokens: TokenUsage) {
	tokenTracker.addTokens(provider, tokens);
}

export function clearTokenUsage(context: vscode.ExtensionContext, provider: string) {
	tokenTracker.clearTokens(provider);
}

// Registry to store token usage by request ID for individual requests
const requestTokenUsage = new Map<string, { tokens: TokenUsage; provider: string }>();

export function recordRequestTokenUsage(requestId: string, provider: string, tokens: TokenUsage) {
	const enabledProviders = vscode.workspace.getConfiguration('positron.assistant').get('approximateTokenCount', [] as string[]);

	enabledProviders.push(AnthropicModelProvider.source.provider.id); // ensure anthropicId is always included

	if (!enabledProviders.includes(provider)) {
		return; // Skip if token counting is disabled for this provider
	}

	requestTokenUsage.set(requestId, { provider, tokens });
	// Clean up old entries to prevent memory leaks
	setTimeout(() => {
		requestTokenUsage.delete(requestId);
	}, 30000); // Clean up after 30 seconds
}

export function getRequestTokenUsage(requestId: string): { tokens: TokenUsage; provider: string } | undefined {
	return requestTokenUsage.get(requestId);
}

/**
 * One-time migration to move API keys from global state to encrypted storage.
 *
 * Previously, API keys were stored in global state in web mode.  This migration
 * moves those keys to encrypted storage and removes them from global state.
 */
async function migrateApiKeysToEncryptedStorage(context: vscode.ExtensionContext): Promise<void> {
	const storedModels = getStoredModels(context);

	for (const model of storedModels) {
		const globalStateKey = `apiKey-${model.id}`;
		const apiKey = context.globalState.get<string>(globalStateKey);

		if (apiKey) {
			log.info(`Migrating API key for model ${model.id} to encrypted storage`);
			try {
				// Save to encrypted storage
				await context.secrets.store(globalStateKey, apiKey);
				// Remove from global state
				await context.globalState.update(globalStateKey, undefined);
				log.info(`Successfully migrated API key for model ${model.id}`);
			} catch (error) {
				log.error(`Failed to migrate API key for model ${model.id}:`, error);
			}
		}
	}
}

export async function activate(context: vscode.ExtensionContext) {
	// Create the log output channel.
	context.subscriptions.push(log);

	tokenTracker = new TokenTracker(context);

	// Migrate API keys from global state to encrypted storage. This is a
	// one-time migration of keys that were stored in global state in versions
	// of Positron 2026.01 and prior.
	//
	// This migration can be removed in a future version.
	await migrateApiKeysToEncryptedStorage(context);

	// Check to see if the assistant is enabled
	const enabled = vscode.workspace.getConfiguration('positron.assistant').get('enable');
	if (enabled) {
		// Register the assistant. We don't propagate errors here since we want
		// the extension to stay activated even if the assistant fails to
		// initialize.
		try {
			const participantService = registerAssistant(context);
			registerAssistantTools(context, participantService);
			const storedModels = getStoredModels(context);
			if (storedModels.length) {
				storedModels.forEach(stored => {
					positron.ai.addLanguageModelConfig(expandConfigToSource(stored));
				});
			}
			await verifyProvidersInCustomModels();
		} catch (error) {
			const msg = error instanceof Error ? error.message : JSON.stringify(error);
			vscode.window.showErrorMessage(
				vscode.l10n.t('Positron Assistant: Failed to enable assistant. {0}', [msg])
			);
		}
	} else {
		// If the assistant is not enabled, listen for configuration changes so that we can
		// enable it immediately if the user enables it in the settings.
		context.subscriptions.push(
			vscode.commands.registerCommand('positron-assistant.enableAssistantSetting', async () => {
				vscode.commands.executeCommand('workbench.action.openSettings', 'positron.assistant.enable');
			}),
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

	return PositronAssistantApi.get();
}
