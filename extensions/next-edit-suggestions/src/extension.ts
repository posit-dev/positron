/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import type { SubmitCompletionFeedbackParams } from './types.js';
import { CompletionBusyState } from './completionBusyState.js';
import { getLanguageClientManager, startLanguageServer, stopLanguageServer } from './client.js';
import { deriveStatusContext, isAIEnabled, isCompletionEnabled, isCompletionEnabledForAnyFileType, isCompletionEnabledForFileType, migrateEnabledSetting } from './config.js';
import { getLLMConfiguration, isSignedIn, resetModelCache } from './model.js';
import { sendFeedback } from './feedback.js';
import { debounceDelayMs, generateSuggestion } from './suggestions.js';

export const log = vscode.window.createOutputChannel('Next Edit Suggestions', { log: true });

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	context.subscriptions.push(log);

	log.info('Next Edit Suggestions extension is now activating...');

	// Gates whether the Next Edit Suggestions status bar item is shown.
	function updateAvailableContext() {
		void vscode.commands.executeCommand('setContext', 'nextEditSuggestions.available', isAIEnabled());
	}

	updateAvailableContext();

	// Migrate the renamed `nextEditSuggestions.enable` setting to `nextEditSuggestions.enabled`.
	const enabledSettingMigration = migrateEnabledSetting(log);

	// Start the language server only when Next Edit Suggestions can actually be
	// used: Positron's AI features are enabled (`ai.enabled`), the feature isn't
	// turned off for every file type (`nextEditSuggestions.enabled`), and an auth
	// token is available. Gating here (not just at request time) keeps the server
	// subprocess from running when it could never produce a suggestion.
	async function ensureLanguageServer() {
		const enabled = isAIEnabled() && isCompletionEnabledForAnyFileType();

		// The signed-in state is checked independently of `enabled` so the status
		// UI can distinguish "signed in but turned off" from "not signed in": the
		// former should let the user re-enable the feature, not prompt a sign-in.
		const signedIn = await isSignedIn();

		// Only resolve the full configuration (which may fetch the model list) when
		// the feature is enabled and could actually produce a suggestion.
		const config = enabled && signedIn ? await getLLMConfiguration() : undefined;
		const status = deriveStatusContext(enabled, signedIn, !!config);
		void vscode.commands.executeCommand('setContext', 'nextEditSuggestions.signedIn', status.signedIn);
		void vscode.commands.executeCommand('setContext', 'nextEditSuggestions.active', status.active);
		void vscode.commands.executeCommand('setContext', 'nextEditSuggestions.provider', config?.providerDisplayName);
		void vscode.commands.executeCommand('setContext', 'nextEditSuggestions.model',
			config ? { id: config.modelId, displayName: config.modelDisplayName } : undefined);
		if (status.active) {
			if (!getLanguageClientManager()) {
				startLanguageServer(context, log);
				log.info('Language server started.');
			}
		} else if (getLanguageClientManager()) {
			log.info('Stopping language server because Next Edit Suggestions is disabled or the user is signed out.');
			await stopLanguageServer();
		}
	}

	void ensureLanguageServer();

	// Publishes whether NES is enabled for the active editor's file so the workbench
	// status UI can reflect it without re-deriving the per-file logic.
	function updateFileEnabledContext() {
		const document = vscode.window.activeTextEditor?.document;
		const fileEnabled = document ? isCompletionEnabledForFileType(document) : true;
		void vscode.commands.executeCommand('setContext', 'nextEditSuggestions.fileEnabled', fileEnabled);
	}

	updateFileEnabledContext();

	context.subscriptions.push(
		vscode.authentication.onDidChangeSessions((e) => {
			if (e.provider.id === 'posit-ai') {
				void ensureLanguageServer();
			}
		}),
		vscode.window.onDidChangeActiveTextEditor(() => updateFileEnabledContext()),
		vscode.workspace.onDidOpenTextDocument(() => updateFileEnabledContext()),
	);

	log.info('Next Edit Suggestions extension activated successfully!');

	context.subscriptions.push(
		vscode.commands.registerCommand('next-edit-suggestions.learnMore', () => {
			void vscode.env.openExternal(vscode.Uri.parse('https://posit.ai'));
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('next-edit-suggestions.restartLsp', async () => {
			try {
				log.info('Restarting LSP server...');
				const clientManager = getLanguageClientManager();
				if (clientManager) {
					await clientManager.client.stop();
					log.info('LSP server stopped');
					await clientManager.client.start();
					log.info('LSP server restarted successfully');
					void vscode.window.showInformationMessage('LSP server restarted successfully');
				} else {
					log.warn('LSP client manager not found');
					void vscode.window.showErrorMessage('LSP client manager not available');
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				log.error(`Error restarting LSP: ${message}`);
				vscode.window.showErrorMessage(`Failed to restart LSP: ${message}`);
			}
		}),
	);

	// Reflects in-flight completion requests in the `nextEditSuggestions.busy` context key.
	const busyState = new CompletionBusyState();

	const providerImpl = {
		displayName: 'Next Edit Suggestions',
		_onDidChangeEmitter: new vscode.EventEmitter<void>(),

		get onDidChange(): vscode.Event<void> {
			return this._onDidChangeEmitter.event;
		},

		provideInlineCompletionItems: async (
			document: vscode.TextDocument,
			position: vscode.Position,
			_context: vscode.InlineCompletionContext,
			token: vscode.CancellationToken,
		): Promise<vscode.InlineCompletionList | undefined> => {
			if (!isCompletionEnabled(document)) {
				return new vscode.InlineCompletionList([]);
			}

			const timeoutPromise = new Promise<null>((resolve) => {
				setTimeout(() => resolve(null), 10000);
			});

			const cancellationPromise = new Promise<null>((resolve) => {
				token.onCancellationRequested(() => resolve(null));
			});

			const result = await busyState.track(
				() => Promise.race([generateSuggestion(document, position), timeoutPromise, cancellationPromise])
			);
			if (!result) {
				return new vscode.InlineCompletionList([]);
			}

			const list = new vscode.InlineCompletionList([result]);
			list.enableForwardStability = true;

			return list;
		},

		handleDidShowCompletionItem(): void { },
		handleListEndOfLifetime(): void { },

		handleEndOfLifetime(item: vscode.InlineCompletionItem, reason: vscode.InlineCompletionEndOfLifeReason): void {
			let feedback: SubmitCompletionFeedbackParams['feedback'];
			switch (reason.kind) {
				case vscode.InlineCompletionEndOfLifeReasonKind.Accepted:
					feedback = 'accepted';
					break;
				case vscode.InlineCompletionEndOfLifeReasonKind.Rejected:
					feedback = 'rejected';
					break;
				case vscode.InlineCompletionEndOfLifeReasonKind.Ignored:
					// A superseded suggestion was replaced by a newer request,
					// not dismissed by the user.
					if (reason.supersededBy) {
						return;
					}
					feedback = 'ignored';
					break;
				default:
					return;
			}
			sendFeedback(item.correlationId, feedback);
		},
	};

	await enabledSettingMigration;
	context.subscriptions.push(
		vscode.languages.registerInlineCompletionItemProvider('*', providerImpl as vscode.InlineCompletionItemProvider, {
			displayName: 'Next Edit Suggestions',
			debounceDelayMs,
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('ai.enabled')) {
				updateAvailableContext();
				// Start/stop the language server to match the new AI-enabled state
				// without waiting for a reload.
				void ensureLanguageServer();
			}
			if (e.affectsConfiguration('nextEditSuggestions')) {
				log.trace(`[config] Refresh configuration due to change in 'nextEditSuggestions' settings.`);
				resetModelCache();
				// Re-run so the model/provider context keys reflect the new selection
				void ensureLanguageServer();
				updateFileEnabledContext();
				providerImpl._onDidChangeEmitter.fire();
			}
		}),
	);
}

export function deactivate(): void { }
