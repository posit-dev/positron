/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { AuthProvider } from './authProvider';
import { providerAction, registerAuthProvider, unregisterAuthProvider, updateProviderFromSessions } from './configDialog';
import { customApiKeyValidator } from './customProviderAuth';
import { log } from './log';
import {
	readCustomProviderEntry,
	saveCustomProviderUrl,
	type ProviderCatalogChangeEvent,
	type ResolvedProviderLike,
} from './providerCatalog';
import { customProviderSource, getRegistrableCustomProviders } from './providerSources';

/**
 * Keeps one VS Code authentication provider and one language model source
 * registered per enabled `providers.custom` entry.
 *
 * Built-in providers are a fixed list registered once at activation. Custom
 * entries are not: the user can add, rename, disable, or delete one by editing
 * providers.json at any point, so this reconciles against the catalog rather
 * than registering a snapshot.
 *
 * The auth provider id is the entry name, which is also the catalog id. That's
 * the contract Posit Assistant's `PositronBackend` resolves credentials
 * against, so it can derive the credential from the provider id instead of
 * carrying a lookup table.
 */
export class CustomProviderRegistry implements vscode.Disposable {
	private readonly registrations = new Map<string, vscode.Disposable[]>();

	constructor(
		private readonly context: vscode.ExtensionContext,
		/** Injectable so a test can register an entry without reaching the workbench. */
		private readonly registerModelSource: typeof positron.ai.registerProvider =
			positron.ai.registerProvider,
	) { }

	/**
	 * Brings registrations in line with the catalog: register entries that are
	 * newly enabled, drop entries that went away or were disabled, and refresh
	 * the defaults of entries whose connection changed under them.
	 */
	async reconcile(change?: ProviderCatalogChangeEvent): Promise<void> {
		const wanted = new Map(
			getRegistrableCustomProviders().map(provider => [provider.id, provider] as const)
		);

		for (const id of [...this.registrations.keys()]) {
			if (!wanted.has(id)) {
				this.unregister(id);
			}
		}

		for (const [id, provider] of wanted) {
			if (!this.registrations.has(id)) {
				await this.register(provider);
			} else if (change?.changedConnectionIds.includes(id)) {
				// Registration stays put so the auth provider keeps its state;
				// only the source's defaults need to catch up.
				positron.ai.updateProvider(id, { defaults: customProviderSource(provider).defaults });
			}
		}
	}

	private async register(provider: ResolvedProviderLike): Promise<void> {
		const name = provider.id;
		const disposables: vscode.Disposable[] = [
			this.registerModelSource(customProviderSource(provider), providerAction),
			{ dispose: () => unregisterAuthProvider(name) },
		];

		// Saving the URL is the other half of the connect action; the key goes
		// to secret storage through the auth provider.
		const onSave = async (config: positron.ai.LanguageModelConfig) => {
			if (!config.baseUrl) {
				return;
			}
			// An entry with no user-layer record comes from a default or
			// enforced layer. Its connection isn't ours to write, and the
			// credential is stored separately, so only the URL is skipped here.
			if (!await readCustomProviderEntry(name)) {
				log.info(`Not saving a URL for externally managed custom provider: ${name}`);
				return;
			}
			await saveCustomProviderUrl(name, config.baseUrl, 'baseUrl');
		};

		// Every offered kind authenticates with a key the user types, so the
		// auth provider holds no credential chain: nothing to resolve from the
		// environment, and nothing that could resolve the built-in's account
		// under this entry's name.
		const authProvider = new AuthProvider(name, name, this.context);
		disposables.push(
			authProvider,
			vscode.authentication.registerAuthenticationProvider(name, name, authProvider),
		);

		registerAuthProvider(name, authProvider, {
			// The same key check the matching built-in runs, so a bad key is
			// caught where it's typed rather than at the first chat.
			validateApiKey: customApiKeyValidator(provider.clientKind),
			onSave,
			// No onDelete: signing out clears the credential and leaves the
			// providers.json entry alone. Removing the entry is its own action.
		});

		this.registrations.set(name, disposables);
		log.info(`Registered custom provider: ${name} (${provider.clientKind})`);

		// Reflect an already-stored credential, the way activation sweeps the
		// built-in providers once. Without this a configured entry shows up as
		// signed out until the next session change.
		const sessions = await authProvider.getSessions();
		await updateProviderFromSessions(name, sessions);

		// Then make the registration itself observable. Registering an auth
		// provider emits nothing to other extensions, and Posit Assistant
		// remembers "no such auth provider" for the rest of the session, so an
		// entry that already had a key stored would stay dead until the user
		// happened to sign in or out. This is the only signal that reaches it.
		authProvider.fireSessionsChanged({ added: sessions, removed: [], changed: [] });
	}

	private unregister(name: string): void {
		for (const disposable of this.registrations.get(name) ?? []) {
			disposable.dispose();
		}
		this.registrations.delete(name);
		log.info(`Unregistered custom provider: ${name}`);
	}

	dispose(): void {
		for (const name of [...this.registrations.keys()]) {
			this.unregister(name);
		}
	}
}
