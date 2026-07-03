/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { validateProvidersEnabled } from './providerConfiguration.js';
import { registerParticipants } from './participants';
import { PositronAssistantApi } from './api.js';
import { PromptRenderer } from './promptRender.js';
import { log } from './log.js';
import { performSettingsMigrations } from './providerMigration.js';

let assistantEnabled = false;

/**
 * Initialize provider configuration system.
 * Must be called during extension activation before registering models.
 */
async function initializeProviderConfiguration(): Promise<void> {
	// 1. Perform settings migrations (provider enablement, model preferences, custom models)
	await performSettingsMigrations();

	// 2. Validate that at least one provider is enabled
	await validateProvidersEnabled();
}

function registerAssistant(context: vscode.ExtensionContext) {
	// Register chat participants
	const participantService = registerParticipants(context);

	// Initialize provider configuration system (registration, migration, validation)
	initializeProviderConfiguration()
		.catch((e) => {
			log.error(`Provider initialization failed: ${e instanceof Error ? e.message : String(e)}`);
		});

	// Initialize prompt renderer singleton
	new PromptRenderer(context);

	// Mark the assistant as enabled
	assistantEnabled = true;

	return participantService;
}

function isActive(): boolean {
	const cfg = vscode.workspace.getConfiguration();
	return cfg.get('ai.enabled') !== false
		&& cfg.get('chat.disableAIFeatures') !== true;
}

export async function activate(context: vscode.ExtensionContext) {
	// Create the log output channel.
	context.subscriptions.push(log);

	if (isActive()) {
		// Register the assistant. We don't propagate errors here since we want
		// the extension to stay activated even if the assistant fails to
		// initialize.
		try {
			registerAssistant(context);
		} catch (error) {
			const msg = error instanceof Error ? error.message : JSON.stringify(error);
			vscode.window.showErrorMessage(
				vscode.l10n.t('Positron Assistant: Failed to enable assistant. {0}', msg)
			);
		}
	} else {
		// Listen for configuration changes so we can register once the gates open.
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration(async e => {
				if (e.affectsConfiguration('ai.enabled') || e.affectsConfiguration('chat.disableAIFeatures')) {
					if (isActive() && !assistantEnabled) {
						try {
							registerAssistant(context);
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
