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
	deleteCustomProviderEntry,
	getCachedProvider,
	readCustomProviderEntry,
	saveCustomProviderUrl,
	type ProviderCatalogChangeEvent,
	type ResolvedProviderLike,
} from './providerCatalog';
import { customProviderSource, getRegistrableCustomProviders } from './providerSources';

/**
 * What the Add Custom Provider form sends. The workbench half of this contract,
 * and what the name means, is `IAddCustomProviderRequest` in
 * `positronAssistant/browser/customProviderCommands.ts`.
 */
export interface AddCustomProviderRequest {
	readonly name: string;
	readonly kind: string;
	readonly baseUrl?: string;
	readonly apiKey?: string;
	readonly modelIds?: readonly string[];
}

/** Narrows the command argument, which arrives as `unknown`. */
export function isAddCustomProviderRequest(value: unknown): value is AddCustomProviderRequest {
	const request = value as AddCustomProviderRequest | undefined;
	return typeof request?.name === 'string' && typeof request?.kind === 'string';
}

/** What the Delete Provider action sends. */
export interface RemoveCustomProviderRequest {
	readonly name: string;
}

/** Narrows the command argument, which arrives as `unknown`. */
export function isRemoveCustomProviderRequest(value: unknown): value is RemoveCustomProviderRequest {
	return typeof (value as RemoveCustomProviderRequest | undefined)?.name === 'string';
}

/**
 * Keeps a language model source registered per enabled `providers.custom` entry.
 * Reconciles against the catalog rather than registering a snapshot, since the
 * user can add, rename, disable, or delete an entry at any point by editing
 * providers.json.
 *
 * Credentials are served through one shared authentication provider,
 * {@link CustomProviderAggregate}, with the entry name as the scope, which is
 * what Posit Assistant resolves against. The per-entry `AuthProvider` still
 * gets the entry name, so secret storage keys are unchanged.
 */
export class CustomProviderRegistry implements vscode.Disposable {
	private readonly registrations = new Map<string, vscode.Disposable[]>();

	/**
	 * Registered for the life of the extension, whether or not any entry exists,
	 * so it can be declared in `contributes.authentication` and reached by an
	 * activation event.
	 */
	private readonly aggregate = new CustomProviderAggregate();
	private readonly aggregateRegistration: vscode.Disposable;

	/**
	 * Serializes reconciles. A create both reconciles directly and triggers the
	 * watcher's reconcile; run concurrently, both would see the new entry as
	 * unregistered and register it twice.
	 */
	private pending: Promise<void> = Promise.resolve();

	constructor(
		private readonly context: vscode.ExtensionContext,
		/** Injectable so a test can register an entry without reaching the workbench. */
		private readonly registerModelSource: typeof positron.ai.registerProvider =
			positron.ai.registerProvider,
		/** Injectable so a test can add an entry without a live endpoint to check the key against. */
		private readonly apiKeyValidator: typeof customApiKeyValidator = customApiKeyValidator,
		/**
		 * Injectable so a test can exercise routing without claiming the shared
		 * id a second time: the extension host is first-one-wins, so a duplicate
		 * registration is dropped and disposing it unregisters the real one.
		 */
		private readonly registerSharedAuthProvider:
			typeof vscode.authentication.registerAuthenticationProvider =
			vscode.authentication.registerAuthenticationProvider,
	) {
		this.aggregateRegistration = this.registerSharedAuthProvider(
			POSITRON_CUSTOM_AUTH_PROVIDER_ID,
			vscode.l10n.t('Custom Provider'),
			this.aggregate,
			// One node in the Accounts menu, with an account per entry.
			{ supportsMultipleAccounts: true },
		);
	}

	/** The entry names registered right now, for the session fan-out. */
	get registeredIds(): string[] {
		return [...this.registrations.keys()];
	}

	/**
	 * Brings registrations in line with the catalog: register newly enabled
	 * entries, drop the ones that went away or were disabled, and refresh the
	 * defaults of the ones whose connection changed.
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
	 * Adds a custom provider from the Add form: the `providers.custom` entry, its
	 * registration, and the credential, in that order. The key is checked before
	 * anything is written, or a rejected one would leave a signed-out entry
	 * behind for a provider the user never managed to add.
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

		// Registration creates the auth provider the key is filed under, so a
		// missing one means the entry was written but isn't serving.
		const authProvider = authProviders.get(name);
		if (!authProvider) {
			throw new Error(vscode.l10n.t('Added "{0}", but it could not be registered. Check the Authentication output channel.', name));
		}

		// Stored even when blank: a gateway with auth switched off has no key, and
		// the session is what makes the entry usable rather than merely present.
		await authProvider.storeKey(randomUUID(), name, apiKey);
		await updateProviderFromSessions(name, await authProvider.getSessions());
		vscode.window.showInformationMessage(vscode.l10n.t('{0} has been added successfully.', name));
	}

	/**
	 * Deletes a custom provider: its credential, then its `providers.custom`
	 * entry, whose removal unregisters it. The credential goes first, while its
	 * auth provider is still registered; a key left behind would come back to
	 * life under a re-created entry of the same name.
	 */
	async remove(name: string): Promise<void> {
		if (!await readCustomProviderEntry(name)) {
			// No user-layer record: the entry is either gone already, or it
			// comes from a default or enforced layer and isn't ours to delete.
			throw new Error(getCachedProvider(name)
				? vscode.l10n.t('"{0}" is managed outside Positron. Remove it from the providers.json that defines it.', name)
				: vscode.l10n.t('There is no custom provider named "{0}".', name));
		}

		// clearConfiguration, not removeSession: the account goes with the secret,
		// so a re-created entry doesn't inherit a stale row.
		await authProviders.get(name)?.clearConfiguration();
		await deleteCustomProviderEntry(name);
		await this.reconcile();

		log.info(`Deleted custom provider: ${name}`);
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
				// Registration stays put; only the defaults need to catch up.
				positron.ai.updateProvider(id, { defaults: customProviderSource(provider).defaults });
			}
		}
	}

	private async register(provider: ResolvedProviderLike): Promise<void> {
		const name = provider.id;

		// The real guard, not the one in create(): a hand-written or externally
		// managed entry arrives here without passing through the form, and one
		// named after a built-in would overwrite that provider's row in
		// configDialog's maps and delete it again on unregister.
		const conflict = customProviderNameConflict(name);
		if (conflict) {
			log.error(`Not registering custom provider "${name}": ${conflict}`);
			return;
		}

		const disposables: vscode.Disposable[] = [
			this.registerModelSource(customProviderSource(provider), providerAction),
			{ dispose: () => unregisterAuthProvider(name) },
		];

		// The other half of the connect action; the key goes to secret storage.
		const onSave = async (config: positron.ai.LanguageModelConfig): Promise<void | boolean> => {
			if (!config.baseUrl) {
				return;
			}
			// Not in providers.json yet means this came from an admin default or
			// an admin-enforced config, and we can't tell which
			// (https://github.com/posit-dev/ai-lib/issues/90). Save anyway: if it
			// turns out to be enforced, the save is harmless, since the enforced
			// value always wins over what's in providers.json.
			if (!await readCustomProviderEntry(name)) {
				if (process.env.POSIT_AI_PROVIDERS_ENFORCED) {
					log.warn(`Saving a URL for custom provider "${name}" that isn't in providers.json yet; this may be overridden if POSIT_AI_PROVIDERS_ENFORCED is set.`);
				}
				await createCustomProviderEntry(name, provider.clientKind as SupportedCustomClientKind, { baseUrl: config.baseUrl });
				return;
			}
			await saveCustomProviderUrl(name, config.baseUrl);
		};

		// No credential chain: every offered kind takes a key the user types, so
		// nothing here can resolve the built-in's ambient account by mistake.
		const authProvider = new AuthProvider(name, name, this.context);
		disposables.push(authProvider);

		registerAuthProvider(name, authProvider, {
			validateApiKey: customApiKeyValidator(provider.clientKind),
			onSave,
			// No onDelete: signing out clears the credential and leaves the entry
			// alone. Removing the entry is its own action.
		});

		this.registrations.set(name, disposables);
		log.info(`Registered custom provider: ${name} (${provider.clientKind})`);

		// Reflect an already-stored credential, the way activation sweeps the
		// built-ins once, or a configured entry reads as signed out.
		const sessions = await authProvider.getSessions();
		await updateProviderFromSessions(name, sessions);

		// Route it through the shared provider, which also announces the sessions
		// it already had. Registering emits nothing on its own, and the assistant
		// caches "no such auth provider" for the session, so an entry with a key
		// already stored would stay dead until the next sign-in.
		await this.aggregate.addProvider(name, authProvider);
	}

	private async unregister(name: string): Promise<void> {
		// Stop routing first: the shared provider outlives the entry, so it is
		// what reports the sessions as removed, and a disposed delegate left in
		// it would still be asked for them.
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
		// Window teardown, so nobody is left to tell about the entries going
		// away. Dropping the shared provider takes its subscriptions with it.
		this.aggregateRegistration.dispose();
		this.aggregate.dispose();
		for (const name of [...this.registrations.keys()]) {
			this.disposeRegistration(name);
		}
	}
}
