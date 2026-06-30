/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { deleteConfiguration, deleteConfigurationByProvider, getStoredModels, syncSessionToGlobalState } from './config';
import { validateProvidersEnabled } from './providerConfiguration.js';
import { registerMappedEditsProvider } from './edits';
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
import { disposeModels, registerModels, registerModelsForProvider } from './modelRegistration';
import { PROVIDER_METADATA } from './providerMetadata.js';
import { ModelConfig } from './configTypes.js';
import { isAuthExtProvider } from './authExtRouting.js';
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

/**
 * Listen for Snowflake configuration changes that affect model registration.
 * Only re-registers Snowflake models when Snowflake-specific settings change.
 */
function registerSnowflakeConfigurationListener(context: vscode.ExtensionContext) {
	const snowflakeProviderId = PROVIDER_METADATA.snowflake.id;

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(async (e) => {
			// Snowflake provider enable setting changed
			if (e.affectsConfiguration('positron.assistant.provider.snowflakeCortex.enable')) {
				log.info('[Assistant] Snowflake provider enable setting changed, re-registering Snowflake models');
				await registerModelsForProvider(context, snowflakeProviderId, 'snowflake-cortex');
			}
			// Snowflake credentials changed in auth extension
			if (e.affectsConfiguration('authentication.snowflake.credentials')) {
				log.info('[Assistant] Snowflake credentials changed, re-registering Snowflake models');
				await registerModelsForProvider(context, snowflakeProviderId, 'snowflake-cortex');
			}
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

async function reconcileAuthProviderModels(
	context: vscode.ExtensionContext,
	providerId: string,
): Promise<boolean> {
	const accounts = await vscode.authentication.getAccounts(providerId);
	const accountIds = new Set(accounts.map(account => account.id));
	const providerModels = getStoredModels(context).filter(model => model.provider === providerId);

	for (const model of providerModels) {
		if (!accountIds.has(model.id)) {
			await deleteConfiguration(context, model.id);
		}
	}

	if (accountIds.size === 0) {
		await deleteConfigurationByProvider(context, providerId);
		return false;
	}

	return getStoredModels(context).some(model => model.provider === providerId);
}

function registerAssistant(context: vscode.ExtensionContext) {
	// Register Copilot service
	registerCopilotService(context);

	// Register chat participants
	const participantService = registerParticipants(context);

	// Gate the session listener until initial model registration completes.
	// Without this, the auth extension resolving credentials during startup
	// fires onDidChangeSessions, which registers models and can cause the
	// LM service to auto-switch the active provider before the initial
	// registerModels() call finishes. Queued events are replayed afterward.
	let initialRegistrationComplete = false;
	const pendingSessionEvents: string[] = [];

	// On Posit Workbench, session-backed providers (AWS, Foundry) may not
	// have stored configs. Re-register with authProviderId to trigger the
	// session-based fallback in registerModelsForProvider. On desktop,
	// these providers only register when the user explicitly configures them.
	const SESSION_PROVIDERS = IS_RUNNING_ON_PWB
		? new Set(['amazon-bedrock', 'ms-foundry', 'snowflake-cortex'])
		: new Set<string>();

	// Initialize provider configuration system (registration, migration, validation)
	initializeProviderConfiguration(context)
		.then(async () => {
			// Reconcile stale auth-backed configs before model registration so
			// startup doesn't attempt to register with missing session IDs.
			const authProviderIds = new Set(
				getStoredModels(context)
					.map(model => model.provider)
					.filter(providerId => isAuthExtProvider(providerId))
			);

			for (const providerId of authProviderIds) {
				try {
					await reconcileAuthProviderModels(context, providerId);
				} catch (error) {
					log.warn(`[Auth Startup Reconcile] Failed for provider ${providerId}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
		})
		.then(() => {
			// After initialization, register models
			return registerModels(context);
		})
		.then(async () => {
			initialRegistrationComplete = true;
			// Replay session events that arrived during startup.
			const unique = [...new Set(pendingSessionEvents)];
			for (const providerId of unique) {
				try {
					await syncSessionToGlobalState(context, providerId);
					await reconcileAuthProviderModels(context, providerId);
					await registerModelsForProvider(context, providerId, providerId);
				} catch (e) {
					log.warn(`[Auth Startup] Deferred session registration failed for ${providerId}: ${e instanceof Error ? e.message : String(e)}`);
				}
			}

			// Register session-backed providers that aren't covered by
			// queued events (e.g. Workbench-managed credentials).
			for (const providerId of SESSION_PROVIDERS) {
				if (!unique.includes(providerId)) {
					await registerModelsForProvider(context, providerId, providerId);
				}
			}
		})
		.catch((e) => {
			initialRegistrationComplete = true;
			log.error(`Provider initialization chain failed: ${e instanceof Error ? e.message : String(e)}`);
		});

	// Keep Positron Assistant model state in sync when auth sessions change.
	context.subscriptions.push(vscode.authentication.onDidChangeSessions(async (e) => {
		const providerId = e.provider.id;
		if (!isAuthExtProvider(providerId)) {
			return;
		}

		// Queue session events during startup -- they are replayed after
		// registerModels() completes to avoid racing with initial setup.
		if (!initialRegistrationComplete) {
			log.info(`[Auth Session Sync] Queuing session event for ${providerId} during initial registration`);
			pendingSessionEvents.push(providerId);
			return;
		}

		try {
			await syncSessionToGlobalState(context, providerId);
			await reconcileAuthProviderModels(context, providerId);
			await registerModelsForProvider(context, providerId, providerId);
		} catch (error) {
			log.warn(`[Auth Session Sync] Failed to sync provider ${providerId}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}));


	// Track opened files for completion context
	registerHistoryTracking(context);

	// Commands
	registerToggleInlineCompletionsCommand(context);
	registerCollectDiagnosticsCommand(context);

	// Initialize prompt renderer singleton
	new PromptRenderer(context);

	// Register mapped edits provider
	registerMappedEditsProvider(context, participantService, log);

	// Register participant detection provider
	registerParticipantDetectionProvider();

	// Listener for configuration changes so that models can be registered without a reload
	// Note: Snowflake uses file-based credentials (connections.toml), handled via
	// positron.assistant.providerVariables.snowflake configuration changes
	registerSnowflakeConfigurationListener(context);

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
