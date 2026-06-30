/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { validateProvidersEnabled } from './providerConfiguration.js';
import { ParticipantService, registerParticipants } from './participants';
import { registerAssistantTools } from './tools.js';
import { registerCopilotService } from './copilot.js';
import { registerParticipantDetectionProvider } from './participantDetection.js';
import { PositronAssistantApi } from './api.js';
import { PromptRenderer } from './promptRender.js';
import { collectDiagnostics } from './diagnostics.js';
import { log } from './log.js';
import { performSettingsMigrations } from './providerMigration.js';
import { IS_RUNNING_ON_PWB } from './constants.js';

// (Authentication provider is registered via registerCopilotAuthProvider)

let assistantEnabled = false;


function registerCollectDiagnosticsCommand(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('positron-assistant.collectDiagnostics', async () => {
			await collectDiagnostics(log);
		})
	);
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
		.catch((e) => {
			log.error(`Provider initialization failed: ${e instanceof Error ? e.message : String(e)}`);
		});

	// Commands
	registerCollectDiagnosticsCommand(context);

	// Initialize prompt renderer singleton
	new PromptRenderer(context);

	// Register participant detection provider
	registerParticipantDetectionProvider();

	// Mark the assistant as enabled
	assistantEnabled = true;

	return participantService;
}

export async function activate(context: vscode.ExtensionContext) {
	// Create the log output channel.
	context.subscriptions.push(log);

	// Check to see if the assistant is enabled
	const enabled = vscode.workspace.getConfiguration('positron.assistant').get('enable');
	if (enabled) {
		// Register the assistant. We don't propagate errors here since we want
		// the extension to stay activated even if the assistant fails to
		// initialize.
		try {
			const participantService = registerAssistant(context);
			registerAssistantTools(context, participantService);
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
