/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { StoredProviderCredentials } from 'ai-credentials/store-backend';
import { POSITRON_LEGACY_AUTH_PROVIDER_IDS, storageKeyFor } from 'ai-credentials/types';
import { extensionSecretStorageKey } from '../../../api/common/extensionSecretStorageKey.js';

/** The extension whose stored credentials are copied. */
export const LEGACY_AUTH_EXTENSION_ID = 'positron.authentication';
/** The extension whose store receives them. */
export const ASSISTANT_EXTENSION_ID = 'posit.assistant';

/** The moved API-key providers; each is looked up in the legacy-ID table, `openai-compatible` never renamed. */
const API_KEY_PROVIDER_IDS = ['anthropic', 'openai', 'gemini', 'deepseek', 'openai-compatible'] as const;

const API_KEY_RENAMES: readonly { legacyId: string; providerId: string }[] = API_KEY_PROVIDER_IDS.map(
	providerId => ({ legacyId: POSITRON_LEGACY_AUTH_PROVIDER_IDS[providerId] ?? providerId, providerId }),
);

const POSIT_AI_ACCESS_TOKEN = 'posit-ai.access_token';
const POSIT_AI_REFRESH_TOKEN = 'posit-ai.refresh_token';
const POSIT_AI_TOKEN_EXPIRY = 'posit-ai.token_expiry';

export interface LegacyStoredAccount {
	readonly id: string;
	readonly label: string;
}

/** Reads from the legacy extension's storage; the contribution supplies the real one. */
export interface LegacyCredentialSource {
	accounts(legacyId: string): readonly LegacyStoredAccount[];
	secret(key: string): Promise<string | undefined>;
}

export interface SecretWrite {
	readonly key: string;
	readonly value: string;
}

export interface LegacyCredentialCopyOptions {
	/** Custom `providers.custom` entry ids; Positron keyed their secrets by entry name. */
	readonly customEntryIds: readonly string[];
	/** The catalog's resolved `positaiLogin.scope`. */
	readonly positaiScope: string;
	readonly now: number;
	readonly generation: () => string;
	readonly log: (level: 'info' | 'warn', message: string) => void;
}

export async function planLegacyCredentialCopy(
	source: LegacyCredentialSource,
	options: LegacyCredentialCopyOptions,
): Promise<SecretWrite[]> {
	const writes: SecretWrite[] = [];
	const targets = [
		...API_KEY_RENAMES,
		...options.customEntryIds.map(id => ({ legacyId: id, providerId: id })),
	];
	for (const { legacyId, providerId } of targets) {
		const apiKey = await firstApiKey(source, legacyId, options.log);
		if (!apiKey) {
			continue;
		}
		writes.push(write(providerId, 'apikey', {
			generation: options.generation(),
			readiness: 'ready',
			source: 'api-key',
			configured: true,
			authenticated: true,
			apiKeyAuth: { apiKey },
		}));
	}

	const positai = await positaiRecord(source, options);
	if (positai) {
		writes.push(write('positai', 'oauth', positai));
	}
	return writes;
}

async function firstApiKey(
	source: LegacyCredentialSource,
	legacyId: string,
	log: LegacyCredentialCopyOptions['log'],
): Promise<string | undefined> {
	const accounts = source.accounts(legacyId);
	let chosen: string | undefined;
	let skipped = 0;
	for (const account of accounts) {
		const key = await source.secret(`apiKey-${legacyId}-${account.id}`);
		if (!key) {
			continue;
		}
		if (chosen === undefined) {
			chosen = key;
		} else {
			skipped++;
		}
	}
	if (skipped > 0) {
		log('info', `${legacyId}: Assistant holds one key per provider; copied the first account and left ${skipped} more`);
	}
	return chosen;
}

async function positaiRecord(
	source: LegacyCredentialSource,
	options: LegacyCredentialCopyOptions,
): Promise<StoredProviderCredentials | undefined> {
	const [accessToken, refreshToken, rawExpiry] = await Promise.all([
		source.secret(POSIT_AI_ACCESS_TOKEN),
		source.secret(POSIT_AI_REFRESH_TOKEN),
		source.secret(POSIT_AI_TOKEN_EXPIRY),
	]);
	if (!accessToken && !refreshToken && !rawExpiry) {
		return undefined;
	}
	if (!accessToken || !refreshToken || !rawExpiry) {
		options.log('warn', 'positai: stored token set is incomplete; not copied, sign in again');
		return undefined;
	}
	const expiryMs = Number(rawExpiry);
	if (!Number.isFinite(expiryMs)) {
		options.log('warn', `positai: token expiry '${rawExpiry}' is not a number; not copied, sign in again`);
		return undefined;
	}
	const expiresAt = new Date(expiryMs).toISOString();
	return {
		generation: options.generation(),
		readiness: 'ready',
		source: 'oauth-device',
		configured: true,
		authenticated: true,
		oauthAuth: {
			tokenData: {
				accessToken,
				refreshToken,
				expiresAt,
				tokenType: 'Bearer',
				scope: options.positaiScope,
			},
			expiresAt,
			scope: options.positaiScope,
		},
	};
}

function write(providerId: string, type: 'apikey' | 'oauth', record: StoredProviderCredentials): SecretWrite {
	return {
		key: extensionSecretStorageKey(ASSISTANT_EXTENSION_ID, storageKeyFor(providerId, type)),
		value: JSON.stringify(record),
	};
}
