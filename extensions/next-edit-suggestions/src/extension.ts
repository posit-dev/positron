/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import type { SubmitCompletionFeedbackParams } from './types.js';
import { getLanguageClientManager, startLanguageServer, stopLanguageServer } from './client.js';
import { isCompletionEnabled } from './config.js';
import { getLLMConfiguration, resetModelCache } from './model.js';
import { sendFeedback } from './feedback.js';
import { debounceDelayMs, generateSuggestion } from './suggestions.js';

export const log = vscode.window.createOutputChannel('Next Edit Suggestions', { log: true });

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(log);

	log.info('Next Edit Suggestions extension is now activating...');

	// Start the language server only when an auth token is available
	async function ensureLanguageServer() {
		if (await getLLMConfiguration()) {
			if (!getLanguageClientManager()) {
				startLanguageServer(context, log);
				log.info('Language server started.');
			}
		} else if (getLanguageClientManager()) {
			log.info('Stopping language server due to logout.');
			await stopLanguageServer();
		}
	}

	void ensureLanguageServer();

	context.subscriptions.push(
		vscode.authentication.onDidChangeSessions((e) => {
			if (e.provider.id === 'posit-ai') {
				void ensureLanguageServer();
			}
		}),
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

			const result = await Promise.race([generateSuggestion(document, position), timeoutPromise, cancellationPromise]);
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

	context.subscriptions.push(
		vscode.languages.registerInlineCompletionItemProvider('*', providerImpl as vscode.InlineCompletionItemProvider, {
			displayName: 'Next Edit Suggestions',
			debounceDelayMs,
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('nextEditSuggestions')) {
				log.trace(`[config] Refresh configuration due to change in 'nextEditSuggestions' settings.`);
				resetModelCache();
				providerImpl._onDidChangeEmitter.fire();
			}
		}),
	);
}

export function deactivate(): void { }
