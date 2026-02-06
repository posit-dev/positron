/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { expandConfigToSource, getStoredModels, logStoredModels, showConfigurationDialog } from './config';
import { registerSupportedProviders, validateProvidersEnabled } from './providerConfiguration.js';
import { registerMappedEditsProvider } from './edits';
import { ParticipantService, registerParticipants } from './participants';
import { registerHistoryTracking } from './completion';
import { registerAssistantTools } from './tools.js';
import { registerCopilotService } from './copilot.js';
import { registerCodeActionProvider } from './codeActions.js';
import { generateCommitMessage } from './git.js';
import { generateNotebookSuggestions, type NotebookSuggestionsResult } from './notebookSuggestions.js';
import { initializeTokenTracking } from './tokens.js';
import { exportChatToUserSpecifiedLocation, exportChatToFileInWorkspace } from './export.js';
import { registerParticipantDetectionProvider } from './participantDetection.js';
import { registerAssistantCommands } from './commands/index.js';
import { PositronAssistantApi } from './api.js';
import { registerPromptManagement } from './promptRender.js';
import { collectDiagnostics } from './diagnostics.js';
import { log } from './log.js';
import { resetAssistantState } from './reset.js';
import { performSettingsMigrations } from './providerMigration.js';
import { disposeModels, registerModels } from './modelRegistration';

// (Authentication provider is registered via registerCopilotAuthProvider)

let assistantEnabled = false;

function registerConfigureProvidersCommand(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron-assistant.configureProviders', async (providerId?: string) => {
			await showConfigurationDialog(context, providerId);
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

	// 2. Perform settings migrations (provider enablement, model preferences, custom models)
	await performSettingsMigrations();

	// 3. Validate that at least one provider is enabled
	await validateProvidersEnabled();
}

function registerAssistant(context: vscode.ExtensionContext) {

	// Register Copilot service
	registerCopilotService(context);

	// Register chat participants
	const participantService = registerParticipants(context);

	// Initialize provider configuration system (registration, migration, validation)
	initializeProviderConfiguration(context)
		.then(() => {
			// After initialization, register models
			return registerModels(context);
		});

	// Track opened files for completion context
	registerHistoryTracking(context);

	// Commands
	registerConfigureProvidersCommand(context);
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

/**
 * One-time migration to move API keys from global state to encrypted storage.
 *
 * Previously, API keys were stored in global state in web mode.  This migration
 * moves those keys to encrypted storage and removes them from global state.
 */
async function migrateApiKeysToEncryptedStorage(context: vscode.ExtensionContext): Promise<void> {
	const storedModels = getStoredModels(context);

	// Start with known keys from Posit AI
	const keysToMigrate: string[] = [
		'positron.assistant.positai.access_token',
		'positron.assistant.positai.refresh_token',
		'positron.assistant.positai.token_expiry',
	];

	// Add keys for all stored models
	for (const model of storedModels) {
		const globalStateKey = `apiKey-${model.id}`;
		keysToMigrate.push(globalStateKey);
	}

	// Migrate all keys that exist in global state to encrypted storage
	for (const key of keysToMigrate) {
		const apiKey = context.globalState.get<string>(key);

		if (apiKey) {
			log.info(`Migrating ${key} to encrypted storage`);
			try {
				// Save to encrypted storage
				await context.secrets.store(key, apiKey);
				// Remove from global state
				await context.globalState.update(key, undefined);
			} catch (error) {
				log.error(`Failed to migrate API ${key}:`, error);
			}
		}
	}
}

export async function activate(context: vscode.ExtensionContext) {
	// Create the log output channel.
	context.subscriptions.push(log);

	initializeTokenTracking(context);

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
