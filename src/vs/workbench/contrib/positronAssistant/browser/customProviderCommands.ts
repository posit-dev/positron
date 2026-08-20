/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Creating a custom provider is one operation the authentication extension has
 * to do as a whole: write the `providers.custom` entry, register an auth
 * provider under the entry name, and store the key there. The modal can't do
 * any of that itself, and the usual `onAction` dispatch is keyed on an already
 * registered provider id, which a new entry doesn't have yet, so the create
 * goes through a command instead.
 *
 * The extension registers the handler and owns the checks that matter (name
 * collisions with built-in provider ids and reserved keys, and the same key
 * check the matching built-in provider runs). It throws on refusal, and the
 * message is what the form shows.
 */
export const ADD_CUSTOM_PROVIDER_COMMAND = 'authentication.addCustomProvider';

/**
 * The argument to {@link ADD_CUSTOM_PROVIDER_COMMAND}. The name is the entry
 * key in providers.json, the provider id, the display name, and the auth
 * provider id, all at once, which is why it can't be changed afterwards.
 */
export interface IAddCustomProviderRequest {
	readonly name: string;
	readonly kind: string;
	/** Where to call. Written as `baseUrl` on the entry. */
	readonly baseUrl?: string;
	/** The key the user typed, stored under the entry name. */
	readonly apiKey?: string;
	/**
	 * Model ids the user declared, for an endpoint with no `/models` listing.
	 * The extension fills in the capability fields, since it owns the schema.
	 */
	readonly modelIds?: readonly string[];
}

/**
 * Set by Posit Assistant at activation on any build that serves models for
 * `providers.custom` entries. Until that build is installed a named entry is
 * configurable but invisible in chat, so the Add affordance waits for the key.
 * A capability key rather than a version check: the assistant auto-updates on
 * its own cadence, so a version comparison goes stale.
 */
export const SUPPORTS_CUSTOM_PROVIDERS_KEY = 'posit-assistant.supportsCustomProviders';
