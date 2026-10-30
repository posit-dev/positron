/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IExtensionStorageService } from '../../../../../platform/extensionManagement/common/extensionStorage.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { ISecretStorageService } from '../../../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { createLightTestContainer } from '../../../../../test/vitest/lightTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IAiProviderService } from '../../../../services/positronAiProvider/common/aiProviderService.js';
import { extensionSecretStorageKey as extensionSecretKey } from '../../../../api/common/extensionSecretStorageKey.js';
import { LegacyCredentialCopyContribution } from '../../browser/legacyCredentialCopyContribution.js';
import { ASSISTANT_EXTENSION_ID, LEGACY_AUTH_EXTENSION_ID } from '../../common/legacyCredentialCopy.js';

describe('LegacyCredentialCopyContribution', () => {
	const secrets = new Map<string, string>();
	let flag = false;
	let extensionState: Record<string, unknown> = {};
	let catalogStatus: 'ready' | 'error' = 'ready';
	let secretsType: ISecretStorageService['type'] = 'persisted';

	const ctx = createLightTestContainer()
		.stub(ISecretStorageService, stubInterface<ISecretStorageService>({
			get: async key => secrets.get(key),
			set: async (key, value) => { secrets.set(key, value); },
			get type() { return secretsType; },
		}))
		.stub(IExtensionStorageService, stubInterface<IExtensionStorageService>({
			getExtensionState: (id, global) =>
				id === LEGACY_AUTH_EXTENSION_ID && global ? extensionState : undefined,
		}))
		.stub(IStorageService, stubInterface<IStorageService>({
			getBoolean: (_key, scope, fallback) => scope === StorageScope.PROFILE ? flag : (fallback ?? false),
			store: (_key, value, scope, target) => {
				expect(scope).toBe(StorageScope.PROFILE);
				expect(target).toBe(StorageTarget.MACHINE);
				flag = value === true;
			},
		}))
		.stub(IAiProviderService, stubInterface<IAiProviderService>({
			whenInitialized: Promise.resolve(),
			get status() { return catalogStatus; },
			getProviders: () => [
				{ id: 'anthropic', enabled: true },
				{ id: 'my-gateway', enabled: true, custom: true },
			],
			getProvider: id => id === 'positai'
				? { id, enabled: true, positaiLoginScope: 'prism' }
				: undefined,
		}))
		.stub(ILogService, new NullLogService())
		.build();

	beforeEach(() => {
		secrets.clear();
		flag = false;
		extensionState = {};
		catalogStatus = 'ready';
		secretsType = 'persisted';
	});

	async function run(): Promise<void> {
		const contribution = ctx.disposables.add(ctx.instantiationService.createInstance(LegacyCredentialCopyContribution));
		await contribution.whenDone;
	}

	it('copies keys and the token triple, then sets the done flag', async () => {
		extensionState = {
			'auth.accounts.anthropic-api': [{ id: 'u', label: 'u' }],
			'auth.accounts.my-gateway': [{ id: 'g', label: 'g' }],
		};
		secrets.set(extensionSecretKey(LEGACY_AUTH_EXTENSION_ID, 'apiKey-anthropic-api-u'), 'sk');
		secrets.set(extensionSecretKey(LEGACY_AUTH_EXTENSION_ID, 'apiKey-my-gateway-g'), 'gw');
		secrets.set(extensionSecretKey(LEGACY_AUTH_EXTENSION_ID, 'posit-ai.access_token'), 'a');
		secrets.set(extensionSecretKey(LEGACY_AUTH_EXTENSION_ID, 'posit-ai.refresh_token'), 'r');
		secrets.set(extensionSecretKey(LEGACY_AUTH_EXTENSION_ID, 'posit-ai.token_expiry'), '1700000000000');

		await run();

		const written = [...secrets.keys()].filter(k => k.includes(ASSISTANT_EXTENSION_ID)).sort();
		expect(written).toEqual([
			extensionSecretKey(ASSISTANT_EXTENSION_ID, 'auth:anthropic:apikey'),
			extensionSecretKey(ASSISTANT_EXTENSION_ID, 'auth:my-gateway:apikey'),
			extensionSecretKey(ASSISTANT_EXTENSION_ID, 'auth:positai:oauth'),
		].sort());
		expect(flag).toBe(true);
	});

	it('does nothing once the flag is set', async () => {
		flag = true;
		extensionState = { 'auth.accounts.anthropic-api': [{ id: 'u', label: 'u' }] };
		secrets.set(extensionSecretKey(LEGACY_AUTH_EXTENSION_ID, 'apiKey-anthropic-api-u'), 'sk');

		await run();

		expect([...secrets.keys()].some(k => k.includes(ASSISTANT_EXTENSION_ID))).toBe(false);
	});

	it('keeps a signed-in Assistant record and replaces a signed-out one', async () => {
		extensionState = {
			'auth.accounts.anthropic-api': [{ id: 'u', label: 'u' }],
			'auth.accounts.my-gateway': [{ id: 'g', label: 'g' }],
		};
		secrets.set(extensionSecretKey(LEGACY_AUTH_EXTENSION_ID, 'apiKey-anthropic-api-u'), 'legacy');
		secrets.set(extensionSecretKey(LEGACY_AUTH_EXTENSION_ID, 'apiKey-my-gateway-g'), 'gw');
		const signedIn = extensionSecretKey(ASSISTANT_EXTENSION_ID, 'auth:anthropic:apikey');
		const signedOut = extensionSecretKey(ASSISTANT_EXTENSION_ID, 'auth:my-gateway:apikey');
		secrets.set(signedIn, '{"authenticated":true,"apiKeyAuth":{"apiKey":"newer"}}');
		secrets.set(signedOut, '{"readiness":"unauthenticated","configured":false,"authenticated":false}');

		await run();

		expect(secrets.get(signedIn)).toBe('{"authenticated":true,"apiKeyAuth":{"apiKey":"newer"}}');
		expect(JSON.parse(secrets.get(signedOut)!).apiKeyAuth).toEqual({ apiKey: 'gw' });
		expect(flag).toBe(true);
	});

	it('leaves the flag unset when the catalog failed to load', async () => {
		catalogStatus = 'error';
		extensionState = { 'auth.accounts.anthropic-api': [{ id: 'u', label: 'u' }] };
		secrets.set(extensionSecretKey(LEGACY_AUTH_EXTENSION_ID, 'apiKey-anthropic-api-u'), 'sk');

		await run();

		expect(flag).toBe(false);
		expect([...secrets.keys()].some(k => k.includes(ASSISTANT_EXTENSION_ID))).toBe(false);
	});

	it('retries only while secret storage is not persisted when accounts have no readable secret', async () => {
		extensionState = { 'auth.accounts.anthropic-api': [{ id: 'u', label: 'u' }] };

		secretsType = 'in-memory';
		await run();
		expect(flag).toBe(false);

		secretsType = 'persisted';
		await run();
		expect(flag).toBe(true);
	});

	it('leaves the flag unset when a write fails', async () => {
		extensionState = { 'auth.accounts.anthropic-api': [{ id: 'u', label: 'u' }] };
		secrets.set(extensionSecretKey(LEGACY_AUTH_EXTENSION_ID, 'apiKey-anthropic-api-u'), 'sk');
		ctx.instantiationService.stub(ISecretStorageService, stubInterface<ISecretStorageService>({
			get: async key => secrets.get(key),
			set: async () => { throw new Error('keychain locked'); },
		}));

		await run();

		expect(flag).toBe(false);
	});
});
