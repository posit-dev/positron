/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { extensionSecretStorageKey as extensionSecretKey } from '../../../../api/common/extensionSecretStorageKey.js';
import {
	ASSISTANT_EXTENSION_ID,
	LegacyCredentialSource,
	planLegacyCredentialCopy,
} from '../../common/legacyCredentialCopy.js';

function source(state: {
	accounts?: Record<string, { id: string; label: string }[]>;
	secrets?: Record<string, string>;
}): LegacyCredentialSource {
	return {
		accounts: id => state.accounts?.[id] ?? [],
		secret: async key => state.secrets?.[key],
	};
}

const options = {
	customEntryIds: [] as string[],
	positaiScope: 'prism',
	generation: () => 'gen-1',
	log: () => { },
};

describe('planLegacyCredentialCopy', () => {
	it('copies an api key under the catalog id', async () => {
		const writes = await planLegacyCredentialCopy(source({
			accounts: { 'anthropic-api': [{ id: 'u1', label: 'me' }] },
			secrets: { 'apiKey-anthropic-api-u1': 'sk-1' },
		}), options);

		expect(writes).toEqual([{
			key: extensionSecretKey(ASSISTANT_EXTENSION_ID, 'auth:anthropic:apikey'),
			value: JSON.stringify({
				generation: 'gen-1',
				readiness: 'ready',
				source: 'api-key',
				configured: true,
				authenticated: true,
				apiKeyAuth: { apiKey: 'sk-1' },
			}),
		}]);
	});

	it('copies a Foundry api key under its unchanged id', async () => {
		const writes = await planLegacyCredentialCopy(source({
			accounts: { 'ms-foundry': [{ id: 'u1', label: 'me' }] },
			secrets: { 'apiKey-ms-foundry-u1': 'fk-1' },
		}), options);

		expect(writes.map(write => write.key)).toEqual([
			extensionSecretKey(ASSISTANT_EXTENSION_ID, 'auth:ms-foundry:apikey'),
		]);
		expect(JSON.parse(writes[0].value)).toMatchObject({ source: 'api-key', apiKeyAuth: { apiKey: 'fk-1' } });
	});

	it('takes the first account with a secret and logs the rest', async () => {
		const logged: string[] = [];
		const writes = await planLegacyCredentialCopy(source({
			accounts: { 'openai-api': [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }] },
			secrets: { 'apiKey-openai-api-a': 'first', 'apiKey-openai-api-b': 'second' },
		}), { ...options, log: (_level, m) => logged.push(m) });

		expect(writes.map(w => JSON.parse(w.value).apiKeyAuth.apiKey)).toEqual(['first']);
		expect(logged.some(m => m.includes('openai-api') && m.includes('1 more'))).toBe(true);
	});

	it('skips blank keys and accounts with no secret', async () => {
		const writes = await planLegacyCredentialCopy(source({
			accounts: { 'deepseek-api': [{ id: 'x', label: 'x' }], 'google': [{ id: 'y', label: 'y' }] },
			secrets: { 'apiKey-deepseek-api-x': '' },
		}), options);

		expect(writes).toEqual([]);
	});

	it('copies custom entries under their own name', async () => {
		const writes = await planLegacyCredentialCopy(source({
			accounts: { 'my-gateway': [{ id: 'c', label: 'c' }] },
			secrets: { 'apiKey-my-gateway-c': 'gw' },
		}), { ...options, customEntryIds: ['my-gateway'] });

		expect(writes.map(w => w.key)).toEqual([
			extensionSecretKey(ASSISTANT_EXTENSION_ID, 'auth:my-gateway:apikey'),
		]);
	});

	it('copies the posit-ai token triple as one oauth-device record', async () => {
		const writes = await planLegacyCredentialCopy(source({
			secrets: {
				'posit-ai.access_token': 'acc',
				'posit-ai.refresh_token': 'ref',
				'posit-ai.token_expiry': '1700000600000',
			},
		}), options);

		expect(writes).toEqual([{
			key: extensionSecretKey(ASSISTANT_EXTENSION_ID, 'auth:positai:oauth'),
			value: JSON.stringify({
				generation: 'gen-1',
				readiness: 'ready',
				source: 'oauth-device',
				configured: true,
				authenticated: true,
				oauthAuth: {
					tokenData: {
						accessToken: 'acc',
						refreshToken: 'ref',
						expiresAt: '2023-11-14T22:23:20.000Z',
						tokenType: 'Bearer',
						scope: 'prism',
					},
					expiresAt: '2023-11-14T22:23:20.000Z',
					scope: 'prism',
				},
			}),
		}]);
	});

	it('skips posit-ai and warns when the triple is incomplete', async () => {
		const warned: string[] = [];
		const writes = await planLegacyCredentialCopy(source({
			secrets: { 'posit-ai.refresh_token': 'ref' },
		}), { ...options, log: (level, m) => { if (level === 'warn') { warned.push(m); } } });
		expect(writes).toEqual([]);
		expect(warned).toHaveLength(1);
	});

	it('stays silent when no posit-ai secrets exist', async () => {
		const warned: string[] = [];
		await planLegacyCredentialCopy(source({}), { ...options, log: (level, m) => { if (level === 'warn') { warned.push(m); } } });
		expect(warned).toEqual([]);
	});
});
