/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { randomUUID } from 'crypto';
import type { SupportedCustomClientKind } from 'ai-config';
import { AuthProvider } from './authProvider';
import { authProviders, providerAction, registerAuthProvider, unregisterAuthProvider, updateProviderFromSessions } from './configDialog';
import { POSITRON_CUSTOM_AUTH_PROVIDER_ID } from './constants';
import { CustomProviderAggregate } from './customProviderAggregate';
import { customApiKeyValidator, customProviderNameConflict, isOfferedCustomKind } from './customProviderAuth';
import { log } from './log';
import {
	createCustomProviderEntry,
	readCustomProviderEntry,
	saveCustomProviderUrl,
	type ProviderCatalogChangeEvent,
	type ResolvedProviderLike,
} from './providerCatalog';
import { customProviderSource, getRegistrableCustomProviders } from './providerSources';

/**
 * What the Add Custom Provider form sends. The name is the entry key in
 * providers.json, the provider id, and the display name all at once, and the
 * scope its credential is filed under, which is why it can't be changed
 * afterwards. The workbench half of this contract is
 * `IAddCustomProviderRequest` in
 * `positronAssistant/browser/customProviderCommands.ts`.
 */
export interface AddCustomProviderRequest {
	readonly name: string;
	readonly kind: string;
	readonly baseUrl?: string;
	readonly apiKey?: string;
	readonly modelIds?: readonly string[];
}

/**
 * Narrows the command argument, which arrives as `unknown` across the command
 * boundary. Only the two fields the create can't proceed without are required;
 * the rest is checked by the writer and the key check.
 */
export function isAddCustomProviderRequest(value: unknown): value is AddCustomProviderRequest {
	const request = value as AddCustomProviderRequest | undefined;
	return typeof request?.name === 'string' && typeof request?.kind === 'string';
}

/**
 * Keeps one VS Code authentication provider and one language model source
 * registered per enabled `providers.custom` entry.
 *
 * Built-in providers are a fixed list registered once at activation. Custom
 * entries are not: the user can add, rename, disable, or delete one by editing
 * providers.json at any point, so this reconciles against the catalog rather
 * than registering a snapshot.
 *
 * Every entry's credential is served through one shared authentication
 * provider, {@link CustomProviderAggregate}, with the entry name as the scope.
 * That is what Posit Assistant's `PositronBackend` resolves against. The
 * per-entry `AuthProvider` is still constructed with the entry name, so the
 * secret storage keys are unchanged; only the registration is shared.
 */
export class CustomProviderRegistry implements vscode.Disposable {
	private readonly registrations = new Map<string, vscode.Disposable[]>();

	/**
	 * The one authentication provider all custom entries are served under. It
	 * is registered for the life of the extension, whether or not any entry
	 * exists, so that it can be declared in `contributes.authentication` and
	 * reached by an activation event.
	 */
	private readonly aggregate = new CustomProviderAggregate();
	private readonly aggregateRegistration: vscode.Disposable;

	/**
	 * Serializes reconciles. Every write refreshes the catalog, which fires a
	 * change event, so a create both reconciles directly and triggers the
	 * watcher's reconcile. Run concurrently, both would see the new entry as
	 * unregistered and register its auth provider twice.
	 */
	private pending: Promise<void> = Promise.resolve();

	constructor(
		private readonly context: vscode.ExtensionContext,
		/** Injectable so a test can register an entry without reaching the workbench. */
		private readonly registerModelSource: typeof positron.ai.registerProvider =
			positron.ai.registerProvider,
		/** Injectable so a test can add an entry without a live endpoint to check the key against. */
		private readonly apiKeyValidator: typeof customApiKeyValidator = customApiKeyValidator,
	) {
		this.aggregateRegistration = vscode.authentication.registerAuthenticationProvider(
			POSITRON_CUSTOM_AUTH_PROVIDER_ID,
			vscode.l10n.t('Custom Providers'),
			this.aggregate,
			// The Accounts menu shows one node with an account per entry,
			// rather than treating them all as one account.
			{ supportsMultipleAccounts: true },
		);
	}

	/** The entry names registered right now, for the session fan-out. */
	get registeredIds(): string[] {
		return [...this.registrations.keys()];
	}

	/**
	 * Brings registrations in line with the catalog: register entries that are
	 * newly enabled, drop entries that went away or were disabled, and refresh
	 * the defaults of entries whose connection changed under them.
	 */
	async reconcile(change?: ProviderCatalogChangeEvent): Promise<void> {
		const run = this.pending.then(
			() => this.reconcileNow(change),
			() => this.reconcileNow(change),
		);
		// A failed reconcile must not poison the queue for the next one.
		this.pending = run.catch(() => undefined);
		return run;
	}

	/**
	 * Adds a custom provider from the Add form: the `providers.custom` entry,
	 * its registration, and the credential, in that order.
	 *
	 * The key is checked before anything is written, by the same check the
	 * matching built-in provider runs. A rejected key would otherwise leave a
	 * signed-out entry behind for a provider the user never managed to add.
	 */
	async create(request: AddCustomProviderRequest): Promise<void> {
		const name = request.name.trim();
		if (!name) {
			throw new Error(vscode.l10n.t('Enter a name for this provider.'));
		}
		if (!isOfferedCustomKind(request.kind)) {
			throw new Error(vscode.l10n.t('Positron cannot configure a "{0}" provider.', request.kind));
		}
		// Reported here so the form says so, rather than writing an entry that
		// then refuses to register.
		const conflict = customProviderNameConflict(name);
		if (conflict) {
			throw new Error(conflict);
		}
		const kind = request.kind as SupportedCustomClientKind;
		const baseUrl = request.baseUrl?.trim();
		const apiKey = request.apiKey?.trim() ?? '';

		await this.apiKeyValidator(kind)?.(apiKey, { baseUrl });

		await createCustomProviderEntry(name, kind, { baseUrl, modelIds: request.modelIds });
		await this.reconcile();

		// Registration is what creates the auth provider the key is filed
		// under, so a missing one here means the entry was written but isn't
		// serving. Say so rather than dropping the key silently.
		const authProvider = authProviders.get(name);
		if (!authProvider) {
			throw new Error(vscode.l10n.t('Added "{0}", but it could not be registered. Check the Authentication output channel.', name));
		}

		// Stored even when blank: a gateway with auth switched off has no key,
		// and the session is what makes the entry usable rather than merely
		// present.
		await authProvider.storeKey(randomUUID(), name, apiKey);
		await updateProviderFromSessions(name, await authProvider.getSessions());
		vscode.window.showInformationMessage(vscode.l10n.t('{0} has been added successfully.', name));
	}

	/** One pass of the reconcile, run one at a time by {@link reconcile}. */
	private async reconcileNow(change?: ProviderCatalogChangeEvent): Promise<void> {
		const wanted = new Map(
			getRegistrableCustomProviders().map(provider => [provider.id, provider] as const)
		);

		for (const id of [...this.registrations.keys()]) {
			if (!wanted.has(id)) {
				await this.unregister(id);
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

		// The real guard, not the one in create(): a reconcile registers
		// whatever the catalog holds, so a hand-written or externally managed
		// entry arrives here without ever passing through the form. Registering
		// one named after a built-in provider would overwrite that provider's
		// row in configDialog's maps and delete it again on unregister.
		const conflict = customProviderNameConflict(name);
		if (conflict) {
			log.error(`Not registering custom provider "${name}": ${conflict}`);
			return;
		}

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
			await saveCustomProviderUrl(name, config.baseUrl);
		};

		// Every offered kind authenticates with a key the user types, so the
		// auth provider holds no credential chain: nothing to resolve from the
		// environment, and nothing that could resolve the built-in's account
		// under this entry's name.
		const authProvider = new AuthProvider(name, name, this.context);
		disposables.push(authProvider);

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

		// Then route the entry through the shared auth provider, which both makes
		// it reachable from Posit Assistant and announces the sessions it
		// already had. Registering emits nothing to other extensions on its
		// own, and the assistant remembers "no such auth provider" for the rest
		// of the session, so an entry with a key already stored would stay dead
		// until the user happened to sign in or out.
		await this.aggregate.addProvider(name, authProvider);
	}

	private async unregister(name: string): Promise<void> {
		// Stop routing before disposing the delegate, and let the shared auth
		// provider report the entry's sessions as removed. It outlives the
		// entry, so nothing else reports the entry going away, and a disposed
		// delegate left in it would still be asked for sessions.
		await this.aggregate.removeProvider(name);
		this.disposeRegistration(name);
		log.info(`Unregistered custom provider: ${name}`);
	}

	private disposeRegistration(name: string): void {
		for (const disposable of this.registrations.get(name) ?? []) {
			disposable.dispose();
		}
		this.registrations.delete(name);
	}

	dispose(): void {
		// Window teardown, so there is nobody left to tell about the entries
		// going away. Dropping the shared provider takes every delegate
		// subscription with it.
		this.aggregateRegistration.dispose();
		this.aggregate.dispose();
		for (const name of [...this.registrations.keys()]) {
			this.disposeRegistration(name);
		}
	}
}
