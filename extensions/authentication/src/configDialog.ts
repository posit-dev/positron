/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

/**
 * Enrich sources with credential state from registered authentication providers.
 * For each source whose provider.id matches a registered auth provider, check
 * whether a session exists and set signedIn accordingly.
 */
async function enrichWithCredentialState(
	sources: positron.ai.LanguageModelSource[]
): Promise<positron.ai.LanguageModelSource[]> {
	return Promise.all(sources.map(async (source) => {
		try {
			const session = await vscode.authentication.getSession(
				source.provider.id, [], { silent: true }
			);
			if (session) {
				return { ...source, signedIn: true };
			}
		} catch (err) {
			if (!(err instanceof Error) || !err.message.includes('is currently registered')) {
				throw err;
			}
		}
		return source;
	}));
}

/**
 * Show the language model configuration dialog. Enriches the caller-provided
 * sources with credential state from this extension's auth providers, then
 * delegates to the Positron core modal.
 *
 * Called via `vscode.commands.executeCommand('authentication.configureProviders', sources, options)`.
 */
export async function showConfigurationDialog(
	sources: positron.ai.LanguageModelSource[],
	options?: positron.ai.ShowLanguageModelConfigOptions
): Promise<void> {
	const enrichedSources = await enrichWithCredentialState(sources);

	return positron.ai.showLanguageModelConfig(
		enrichedSources,
		async (_config, action) => {
			switch (action) {
				case 'save':
					// Phase 3: store API key via ApiKeyAuthenticationProvider
					break;
				case 'delete':
					// Phase 3: remove auth session
					break;
				case 'oauth-signin':
					// Phase 5: handle OAuth sign-in
					break;
				case 'oauth-signout':
					// Phase 5: handle OAuth sign-out
					break;
				case 'cancel':
					// Phase 5: cancel pending OAuth operations
					break;
				default:
					throw new Error(
						vscode.l10n.t('Invalid action: {0}', action)
					);
			}
		},
		options
	);
}
