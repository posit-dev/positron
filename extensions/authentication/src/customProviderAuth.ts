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
 * Which credential a custom entry's client kind needs. This is a property of
 * the client, not of Positron: Posit Assistant derives the same value for the
 * same entry when it decides which auth provider to read a credential from, so
 * the two products must agree.
 */
export type CustomAuthMethod = 'apikey' | 'aws-credentials' | 'google-cloud' | 'local';

/**
 * What a kind needs to authenticate. Mirrors ai-credentials' `CustomAuthMapping`
 * field for field, `apiKeyOptional` included: a gateway with auth switched off
 * works with no key at all, and a form that treats it like Anthropic would
 * refuse a setup Posit Assistant accepts.
 */
export interface CustomAuthDescriptor {
	readonly authMethod: CustomAuthMethod;
	/** Whether the entry works with no key at all. */
	readonly apiKeyOptional: boolean;
}

/**
 * Local copy of ai-credentials' `CUSTOM_CLIENT_KIND_AUTH_DESCRIPTORS`, which is
 * the authority. It can't be imported: `ai-credentials` publishes only an
 * `import` condition and isn't a dependency of this extension, so the values
 * are duplicated until ai-config re-exports them next to
 * `SUPPORTED_CUSTOM_CLIENT_KIND_VALUES` (posit-dev/ai-lib issue pending).
 *
 * Exhaustive over the supported kinds, so a kind added in ai-config fails to
 * compile here until it is given a credential story. Being in this table says
 * what the kind needs, not that Positron offers it: {@link OFFERED_KINDS} is
 * the shorter list Positron presents today.
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
 * The kinds Positron offers as custom entries today: the three that need
 * nothing but an API key and a base URL, and whose built-in counterparts
 * already have a form and a key check to reuse.
 *
 * The rest are deliberately left out for now. Each one needs connection fields
 * Positron can't collect yet (an AWS profile, a Snowflake home, a GCP project
 * and location), and without them an entry either can't reach an account of its
 * own or silently resolves the same ambient credential as its built-in. They
 * come back with the Add and Edit UI, which can ask for those fields (#12747).
 *
 * Until then this list is shorter than the set Posit Assistant registers on, so
 * an entry of another kind still works there and can still be hand-written; it
 * just doesn't appear in Positron's provider list.
 */
const OFFERED_KINDS: ReadonlySet<string> = new Set<SupportedCustomClientKind>([
	'openai-compatible', 'anthropic', 'openai',
]);

/** Whether Positron presents this kind as a custom entry. */
export function isOfferedCustomKind(kind: string): boolean {
	return OFFERED_KINDS.has(kind);
}

/** What a kind needs to authenticate, or undefined for a kind we don't support. */
export function customAuthDescriptor(kind: string): CustomAuthDescriptor | undefined {
	return CUSTOM_KIND_AUTH_DESCRIPTORS[kind as SupportedCustomClientKind];
}

/**
 * The key check the matching built-in provider runs, by kind. A custom entry
 * gets the same one, so a bad Anthropic key is caught where it's typed instead
 * of at the first chat.
 */
const VALIDATOR_BY_KIND: Partial<Record<SupportedCustomClientKind, ApiKeyValidator>> = {
	'openai-compatible': validateCustomProviderApiKey,
	anthropic: validateAnthropicApiKey,
	openai: validateOpenaiApiKey,
};

/**
 * The key check to run when a custom entry of this kind is saved, or undefined
 * when there is nothing to check.
 *
 * Wraps the kind's own check with the empty-key rule, which is the only place
 * `apiKeyOptional` has teeth today: a kind that requires a key says so at save
 * time rather than failing later at the first request.
 *
 * An optional key only means the check can't refuse a blank field. It still
 * runs: for `openai-compatible` it is `validateCustomProviderApiKey`, which is
 * also what requires a base URL and probes it, and which already sends no
 * Authorization header when there's no key.
 */
export function customApiKeyValidator(kind: string): ApiKeyValidator | undefined {
	const descriptor = customAuthDescriptor(kind);
	// No key to check when the credential isn't one: a `local` kind holds none,
	// and the env-resolved kinds resolve theirs.
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
