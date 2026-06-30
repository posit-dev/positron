/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { getStoredModels } from './config';
import { validateProvidersEnabled } from './providerConfiguration.js';
import { ParticipantService, registerParticipants } from './participants';
import { registerHistoryTracking } from './completion';
import { registerAssistantTools } from './tools.js';
import { registerCopilotService } from './copilot.js';
import { registerParticipantDetectionProvider } from './participantDetection.js';
import { PositronAssistantApi } from './api.js';
import { PromptRenderer } from './promptRender.js';
import { collectDiagnostics } from './diagnostics.js';
import { log } from './log.js';
import { performSettingsMigrations } from './providerMigration.js';
import { disposeModels, registerModels } from './modelRegistration';
import { IS_RUNNING_ON_PWB } from './constants.js';

// (Authentication provider is registered via registerCopilotAuthProvider)

let assistantEnabled = false;

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

async function toggleInlineCompletions() {
	// Get the current value of the setting
	const config = vscode.workspace.getConfiguration('positron.assistant');
	const currentSettings = config.get<Record<string, boolean>>('inlineCompletions.enable') || {};

	// Get the current file's language ID if there's an active text editor
	const activeEditor = vscode.window.activeTextEditor;
	const currentLanguageId = activeEditor?.document.languageId;

	let keyToToggle: string;
	let currentValue: boolean;

	if (currentLanguageId && Object.prototype.hasOwnProperty.call(currentSettings, currentLanguageId)) {
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
	// 1. Perform settings migrations (provider enablement, model preferences, custom models)
	await performSettingsMigrations();

	// 2. Apply PWB-specific provider defaults
	await applyPwbProviderDefaults(context);

	// 3. Validate that at least one provider is enabled
	await validateProvidersEnabled();
}

/**
 * Apply PWB-specific provider defaults.
 *
 * On Posit Workbench, Posit AI should default to disabled, but users and admins
 * can still configure it. Since package.json doesn't support conditional defaults,
 * we use globalState to track whether we've applied the PWB default. This ensures:
 * - First run on PWB: Posit AI is disabled (unless already configured)
 * - Admin configures via policy: their choice is respected because we can't overwrite admin policies
 * - User changes the setting: their choice is preserved
 * - Subsequent runs: we don't overwrite existing choices
 *
 * See: https://github.com/posit-dev/positron/issues/12954
 */
async function applyPwbProviderDefaults(context: vscode.ExtensionContext): Promise<void> {
	if (!IS_RUNNING_ON_PWB) {
		return;
	}

	const pwbDefaultAppliedKey = 'positAI.pwbDefaultApplied';
	const pwbDefaultApplied = context.globalState.get<boolean>(pwbDefaultAppliedKey);

	if (!pwbDefaultApplied) {
		const config = vscode.workspace.getConfiguration('positron.assistant.provider.positAI');
		const currentValue = config.get<boolean>('enable');

		// If already disabled (by admin policy, user, or any other means), nothing to do
		if (currentValue !== false) {
			const enableInspect = config.inspect<boolean>('enable');

			// Only apply default if no one has explicitly configured this setting.
			// Admin policy values aren't exposed via inspect(), but if an admin
			// enforced a policy, the update will fail and we catch it below.
			const hasExplicitValue = enableInspect?.globalValue !== undefined ||
				enableInspect?.workspaceValue !== undefined ||
				enableInspect?.workspaceFolderValue !== undefined;

			if (!hasExplicitValue) {
				try {
					await config.update('enable', false, vscode.ConfigurationTarget.Global);
				} catch (e) {
					// Setting may be enforced by admin policy; log and continue
					log.warn(`Posit AI enablement enforced by admin policy and cannot be updated: ${e instanceof Error ? e.message : String(e)}`);
				}
			}
		}

		// Always mark as applied so we don't retry
		await context.globalState.update(pwbDefaultAppliedKey, true);
	}
}

function registerAssistant(context: vscode.ExtensionContext) {
	// Register Copilot service
	registerCopilotService(context);

	// Register chat participants
	const participantService = registerParticipants(context);

	// Initialize provider configuration system (registration, migration, validation)
	initializeProviderConfiguration(context)
		.then(() => registerModels(context))
		.catch((e) => {
			log.error(`Provider initialization chain failed: ${e instanceof Error ? e.message : String(e)}`);
		});

	// Track opened files for completion context
	registerHistoryTracking(context);

	// Commands
	registerToggleInlineCompletionsCommand(context);
	registerCollectDiagnosticsCommand(context);

	// Initialize prompt renderer singleton
	new PromptRenderer(context);

	// Register participant detection provider
	registerParticipantDetectionProvider();

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
					positron.ai.updateProvider(stored.provider, { signedIn: true });
				});
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : JSON.stringify(error);
			vscode.window.showErrorMessage(
				vscode.l10n.t('Positron Assistant: Failed to enable assistant. {0}', msg)
			);
		}
	} else {
		// If the assistant is not enabled, listen for configuration changes so that we can
		// enable it immediately if the user enables it in the settings.
		context.subscriptions.push(
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
									'Positron Assistant: Failed to enable assistant. {0}', e.message));
						}
					}
				}
			}));
	}

	return PositronAssistantApi.get();
}
