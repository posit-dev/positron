/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { AuthProvider } from './authProvider';
import { providerAction, registerAuthProvider, registerProviderCallbacks, unregisterAuthProvider, updateProviderFromSessions } from './configDialog';
import { customAuthMethod, customCredentialChain } from './customProviderAuth';
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

	constructor(private readonly context: vscode.ExtensionContext) { }

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
		const authMethod = customAuthMethod(provider.clientKind);
		const disposables: vscode.Disposable[] = [
			positron.ai.registerProvider(customProviderSource(provider), providerAction),
			{ dispose: () => unregisterAuthProvider(name) },
		];

		// Saving the URL is the whole connect action for a local entry, and the
		// only part of it for the rest. Which key holds the URL depends on the
		// kind: the chat runtime reads `endpoint` for a local entry.
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
			await saveCustomProviderUrl(
				name, config.baseUrl, authMethod === 'local' ? 'endpoint' : 'baseUrl'
			);
		};

		// A local kind holds no credential, and Posit Assistant expects no auth
		// provider for one: its endpoint comes from its own providers.json
		// entry. Registering one anyway would add an account that can never be
		// signed in.
		if (authMethod === 'local') {
			registerProviderCallbacks(name, { onSave });
			this.registrations.set(name, disposables);
			log.info(`Registered custom provider: ${name} (${provider.clientKind}, local)`);
			return;
		}

		// A kind whose credential comes from the environment gets the same
		// resolver the matching built-in uses. Without it the entry would offer
		// no API key field (correctly, it takes none) and have nothing to
		// resolve either, so Posit Assistant would find no credential under the
		// entry name and the row could never connect.
		const credentialChain = authMethod && customCredentialChain(name, authMethod);
		const authProvider = new AuthProvider(
			name, name, this.context, undefined, credentialChain || undefined
		);
		disposables.push(
			authProvider,
			vscode.authentication.registerAuthenticationProvider(name, name, authProvider),
		);

		registerAuthProvider(name, authProvider, {
			onSave,
			// No onDelete: signing out clears the credential and leaves the
			// providers.json entry alone. Removing the entry is its own action.
		});

		this.registrations.set(name, disposables);
		log.info(`Registered custom provider: ${name} (${provider.clientKind}, ${authMethod})`);

		// Resolve an env-backed credential once at registration, the way the
		// built-in Bedrock and GEAP providers do, so the entry reads as
		// connected without the user pressing anything.
		if (credentialChain) {
			await authProvider.resolveChainCredentials().catch(err =>
				log.debug(`Initial credential resolution for ${name}: ${err}`)
			);
		}

		// Reflect an already-stored credential, the way activation sweeps the
		// built-in providers once. Without this a configured entry shows up as
		// signed out until the next session change.
		await updateProviderFromSessions(name, await authProvider.getSessions());
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
