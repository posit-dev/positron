/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { SupportedCustomClientKind } from 'ai-config';
import type { ApiKeyValidator } from './configDialog';
import {
	validateAnthropicApiKey,
	validateCustomProviderApiKey,
	validateOpenaiApiKey,
} from './validation';

/**
 * Which credential a kind needs. A property of the client, not of Positron: Posit
 * Assistant derives the same value, so the two products must agree.
 */
export type CustomAuthMethod = 'apikey' | 'aws-credentials' | 'google-cloud' | 'local';

/** Mirrors ai-credentials' `CustomAuthMapping` field for field. */
export interface CustomAuthDescriptor {
	readonly authMethod: CustomAuthMethod;
	/** Whether the entry works with no key at all. */
	readonly apiKeyOptional: boolean;
}

/**
 * Local copy of ai-credentials' `CUSTOM_CLIENT_KIND_AUTH_DESCRIPTORS`, the
 * authority, which can't be imported here yet: https://github.com/posit-dev/ai-lib/issues/89.
 * Exhaustive, so a kind added in ai-config fails to compile until it has a
 * credential story; that isn't the same as Positron offering it, which
 * {@link OFFERED_KINDS} decides.
 */
const CUSTOM_KIND_AUTH_DESCRIPTORS = {
	'openai-compatible': { authMethod: 'apikey', apiKeyOptional: true },
	anthropic: { authMethod: 'apikey', apiKeyOptional: false },
	openai: { authMethod: 'apikey', apiKeyOptional: false },
	gemini: { authMethod: 'apikey', apiKeyOptional: false },
	deepseek: { authMethod: 'apikey', apiKeyOptional: false },
	openrouter: { authMethod: 'apikey', apiKeyOptional: false },
	'ms-foundry': { authMethod: 'apikey', apiKeyOptional: false },
	litellm: { authMethod: 'apikey', apiKeyOptional: true },
	portkey: { authMethod: 'apikey', apiKeyOptional: true },
	snowflake: { authMethod: 'apikey', apiKeyOptional: false },
	aws: { authMethod: 'aws-credentials', apiKeyOptional: false },
	'google-vertex': { authMethod: 'google-cloud', apiKeyOptional: false },
	ollama: { authMethod: 'local', apiKeyOptional: false },
	lmstudio: { authMethod: 'local', apiKeyOptional: false },
} as const satisfies Record<SupportedCustomClientKind, CustomAuthDescriptor>;

/**
 * The kinds Positron offers today: the three that need nothing but an API key and
 * a base URL. The rest need a connection field the modal can't ask for yet (an
 * AWS profile, a Snowflake home, a GCP project), without which an entry can't
 * reach an account of its own, and arrive with those fields (#12747). Shorter
 * than the set Posit Assistant registers on, where such an entry still works.
 */
const OFFERED_KINDS: ReadonlySet<string> = new Set<SupportedCustomClientKind>([
	'openai-compatible', 'anthropic', 'openai',
]);

/**
 * Names a `providers.custom` entry can't have, because this extension uses them
 * as authentication provider ids: an entry named after one overwrites that
 * provider's row in `configDialog`'s maps, keyed by the same string, and deletes
 * it again on unregister. The last is the shared provider's own, which would
 * claim the aggregate's session events.
 *
 * Read straight from this extension's own `contributes.authentication` manifest
 * entries rather than a hand-kept list, so the two can't drift apart.
 *
 * A different set from what ai-config's name policy rejects (built-in *provider*
 * ids).
 */
export function reservedAuthProviderIds(): readonly string[] {
	return vscode.extensions.getExtension('positron.authentication')!
		.packageJSON.contributes.authentication
		.map((entry: { id: string }) => entry.id);
}

/**
 * Why this name can't be a custom provider, or undefined if it can. Checked on
 * the registration path as well as at the form, since a hand-written or
 * externally managed entry never goes through the form.
 */
export function customProviderNameConflict(name: string): string | undefined {
	if (reservedAuthProviderIds().includes(name)) {
		return vscode.l10n.t(
			'"{0}" is reserved for a built-in provider. Choose a different name.', name);
	}
	return undefined;
}

/** Whether Positron presents this kind as a custom entry. */
export function isOfferedCustomKind(kind: string): boolean {
	return OFFERED_KINDS.has(kind);
}

/** What a kind needs to authenticate, or undefined for a kind we don't support. */
export function customAuthDescriptor(kind: string): CustomAuthDescriptor | undefined {
	return CUSTOM_KIND_AUTH_DESCRIPTORS[kind as SupportedCustomClientKind];
}

/**
 * The key check the matching built-in runs, by kind. A custom entry gets the same
 * one, so a bad key is caught where it's typed rather than at the first chat.
 */
const VALIDATOR_BY_KIND: Partial<Record<SupportedCustomClientKind, ApiKeyValidator>> = {
	'openai-compatible': validateCustomProviderApiKey,
	anthropic: validateAnthropicApiKey,
	openai: validateOpenaiApiKey,
};

/**
 * The key check to run when an entry of this kind is saved, or undefined when
 * there is nothing to check. Wraps the kind's own check with the empty-key rule,
 * so a kind that requires a key says so at save time.
 *
 * An optional key only means the check can't refuse a blank field; it still runs.
 * `openai-compatible`'s is also what requires a base URL and probes it, and it
 * sends no Authorization header when there's no key.
 */
export function customApiKeyValidator(kind: string): ApiKeyValidator | undefined {
	const descriptor = customAuthDescriptor(kind);
	// Nothing to check when the credential isn't a key: a `local` kind holds
	// none, and the env-resolved kinds resolve theirs.
	if (descriptor?.authMethod !== 'apikey') {
		return undefined;
	}
	const validate = VALIDATOR_BY_KIND[kind as SupportedCustomClientKind];
	const keyRequired = !descriptor.apiKeyOptional;
	if (!validate && !keyRequired) {
		return undefined;
	}
	return async (apiKey, config) => {
		if (!apiKey && keyRequired) {
			throw new Error(vscode.l10n.t('An API key is required for a {0} provider', kind));
		}
		await validate?.(apiKey, config);
	};
}
