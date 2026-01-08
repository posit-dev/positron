/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { EncryptedSecretStorage, expandConfigToSource, getModelConfigurations, getStoredModels, GlobalSecretStorage, logStoredModels, ModelConfig, SecretStorage, showConfigurationDialog, StoredModelConfig } from './config';
import { createAutomaticModelConfigs, newLanguageModelChatProvider } from './providers';
import { getEnabledProviders, registerSupportedProviders, validateByProviderPreferences, validateProvidersEnabled } from './providerConfiguration.js';
import { registerMappedEditsProvider } from './edits';
import { ParticipantService, registerParticipants } from './participants';
import { registerHistoryTracking } from './completion';
import { registerAssistantTools } from './tools.js';
import { registerCopilotService } from './copilot.js';
import { ALL_DOCUMENTS_SELECTOR } from './constants.js';
import { registerCodeActionProvider } from './codeActions.js';
import { generateCommitMessage } from './git.js';
import { generateNotebookSuggestions, type NotebookSuggestionsResult } from './notebookSuggestions.js';
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
import { performProviderMigration } from './providerMigration.js';
import { validateProvidersInCustomModels } from './modelDefinitions.js';
import { disposeModels, registerModelConfigListeners, registerModels, updateLastEnabledProviders } from './modelRegistration';

// (Authentication provider is registered via registerCopilotAuthProvider)

let assistantEnabled = false;
let tokenTracker: TokenTracker;

/**
 * An error thrown by the assistant that can optionally be displayed to the user.
 */
export class AssistantError extends Error {
	constructor(message: string, public readonly display: boolean = true) {
		super(message);
	}
}

export const log = new BufferedLogOutputChannel(
	vscode.window.createOutputChannel('Assistant', { log: true })
);

function registerConfigureProvidersCommand(context: vscode.ExtensionContext, storage: SecretStorage) {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron-assistant.configureProviders', async () => {
			await showConfigurationDialog(context, storage);
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

/**
 * Initialize provider configuration system.
 * Must be called during extension activation before registering models.
 */
async function initializeProviderConfiguration(context: vscode.ExtensionContext): Promise<void> {
	// 1. Register supported providers
	registerSupportedProviders();

	// 2. Perform one-time migration from old to new provider settings (non-blocking)
	// This is non-blocking because getEnabledProviders() supports both old and new settings
	performProviderMigration();

	// 3. Validate that at least one provider is enabled
	await validateProvidersEnabled();

	// 4. Validate that custom models reference valid providers
	await validateProvidersInCustomModels();

	// 5. Validate that byProvider preferences reference valid providers
	validateByProviderPreferences();
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

	// Initialize provider configuration system (registration, migration, validation)
	initializeProviderConfiguration(context)
		.then(() => {
			// After initialization, register models
			return registerModels(context, storage);
		})
		.then(() => {
			// Update last enabled providers after initial registration
			updateLastEnabledProviders();
		});

	// Listen for configuration changes
	registerModelConfigListeners(context, storage);

	// Track opened files for completion context
	registerHistoryTracking(context);

	// Commands
	registerConfigureProvidersCommand(context, storage);
	registerGenerateCommitMessageCommand(context, participantService, log);
	registerGenerateNotebookSuggestionsCommand(context, participantService, log);
	registerExportChatCommands(context);
	registerToggleInlineCompletionsCommand(context);
	registerCollectDiagnosticsCommand(context);
	registerResetCommand(context);

	// Register prompt management
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

export async function activate(context: vscode.ExtensionContext) {
	// Create the log output channel.
	context.subscriptions.push(log);

	tokenTracker = new TokenTracker(context);

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
			vscode.workspace.onDidChangeConfiguration(async e => {
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
