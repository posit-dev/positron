/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SupportedCustomClientKind } from 'ai-config';
import type { CredentialChainConfig } from './authProvider';
import { AuthProviderLogger } from './authProviderLogger';
import { CREDENTIAL_REFRESH_INTERVAL_MS } from './constants';
import { resolveAwsCredential } from './credentials/aws';
import { resolveGeapCredential } from './credentials/geap';
import { getCachedProvider } from './providerCatalog';

/**
 * Which credential a custom entry's client kind needs. This is a property of
 * the client, not of Positron: Posit Assistant derives the same value for the
 * same entry when it decides which auth provider to read a credential from, so
 * the two products must agree.
 */
export type CustomAuthMethod = 'apikey' | 'aws-credentials' | 'google-cloud' | 'local';

/**
 * Local copy of ai-credentials' `CUSTOM_CLIENT_KIND_AUTH_DESCRIPTORS`, which is
 * the authority. It can't be imported: `ai-credentials` publishes only an
 * `import` condition and isn't a dependency of this extension, so the values
 * are duplicated until ai-config re-exports them next to
 * `SUPPORTED_CUSTOM_CLIENT_KIND_VALUES` (posit-dev/ai-lib issue pending).
 *
 * Exhaustive over the supported kinds, so a kind added in ai-config fails to
 * compile here until it is given a credential story.
 */
const CUSTOM_KIND_AUTH_METHOD = {
	'openai-compatible': 'apikey',
	anthropic: 'apikey',
	openai: 'apikey',
	gemini: 'apikey',
	deepseek: 'apikey',
	openrouter: 'apikey',
	'ms-foundry': 'apikey',
	litellm: 'apikey',
	portkey: 'apikey',
	snowflake: 'apikey',
	aws: 'aws-credentials',
	'google-vertex': 'google-cloud',
	ollama: 'local',
	lmstudio: 'local',
} satisfies Record<SupportedCustomClientKind, CustomAuthMethod>;

/** The credential a kind needs, or undefined for a kind we don't support. */
export function customAuthMethod(kind: string): CustomAuthMethod | undefined {
	return CUSTOM_KIND_AUTH_METHOD[kind as SupportedCustomClientKind];
}

/**
 * How Positron obtains the credential for one custom entry, or undefined when
 * there is no chain to resolve: `apikey` kinds store a user-entered key in
 * secret storage, and `local` kinds need no credential at all.
 *
 * The env-resolved kinds reuse the same resolvers the built-in Bedrock and GEAP
 * providers use, and read the entry's own connection slice at resolve time
 * rather than closing over a snapshot, so editing the entry's region, profile,
 * project, or location takes effect on the next refresh.
 */
export function customCredentialChain(
	name: string,
	method: CustomAuthMethod
): CredentialChainConfig | undefined {
	switch (method) {
		case 'aws-credentials':
			return {
				resolve: () => resolveAwsCredential(
					getCachedProvider(name)?.connection.aws,
					process.env
				),
			};
		case 'google-cloud':
			return {
				resolve: () => resolveGeapCredential(
					getCachedProvider(name)?.connection.googleCloud,
					new AuthProviderLogger(name)
				),
				refreshIntervalMs: CREDENTIAL_REFRESH_INTERVAL_MS,
			};
		default:
			return undefined;
	}
}
