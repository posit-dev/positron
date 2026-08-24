/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Creates a `providers.custom` entry, routes it through the shared
 * authentication provider, and stores its key: one operation, all of it the
 * authentication extension's. A command rather than the usual `onAction`
 * dispatch, which is keyed on a provider id a new entry doesn't have yet. The
 * extension owns the checks and throws on refusal, with the message the form
 * shows.
 */
export const ADD_CUSTOM_PROVIDER_COMMAND = 'authentication.addCustomProvider';

/**
 * The argument to {@link ADD_CUSTOM_PROVIDER_COMMAND}. The name is the entry key
 * in providers.json, the provider id, the display name, and the scope the
 * credential is filed under, which is why it can't be changed afterwards.
 */
export interface IAddCustomProviderRequest {
	readonly name: string;
	readonly kind: string;
	/** Where to call. Written as `baseUrl` on the entry. */
	readonly baseUrl?: string;
	readonly apiKey?: string;
	/** Model ids for an endpoint with no `/models` listing. */
	readonly modelIds?: readonly string[];
}

/**
 * The create in reverse: clear the credential, remove the entry, and let the
 * reconcile that follows unregister it. A command for the same reason the add
 * is, and it throws with the message the confirmation screen shows.
 */
export const REMOVE_CUSTOM_PROVIDER_COMMAND = 'authentication.removeCustomProvider';

/** The argument to {@link REMOVE_CUSTOM_PROVIDER_COMMAND}. */
export interface IRemoveCustomProviderRequest {
	readonly name: string;
}

/**
 * The one authentication provider every `providers.custom` entry is served
 * under, with the entry name as the scope. A session change on it doesn't say
 * which entry moved, so a listener has to ask per entry, by scope.
 */
export const POSITRON_CUSTOM_AUTH_PROVIDER_ID = 'positron-custom-provider';

/**
 * Set by Posit Assistant on any build that serves models for `providers.custom`
 * entries. Until then an entry is configurable but invisible in chat, so the Add
 * affordance waits for the key. A capability key rather than a version check,
 * since the assistant auto-updates on its own cadence.
 */
export const SUPPORTS_CUSTOM_PROVIDERS_KEY = 'posit-assistant.supportsCustomProviders';
