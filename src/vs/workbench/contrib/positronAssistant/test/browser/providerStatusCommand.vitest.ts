/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IResolvedProviderData } from '../../../../../platform/positronAiProvider/common/aiProviderCatalog.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { AiProviderServiceStatus, IAiProviderService } from '../../../../services/positronAiProvider/common/aiProviderService.js';
import { getProviderStatus } from '../../browser/providerStatusCommand.js';
import { IPositronAssistantConfigurationService, IPositronLanguageModelSource, PositronLanguageModelType } from '../../common/interfaces/positronAssistantService.js';

/** A provider registration, as the authentication extension would push it. */
interface IRegistrationSpec {
	id: string;
	catalogId?: string;
	displayName?: string;
	signedIn?: boolean;
	status?: 'ok' | 'error' | null;
	statusMessage?: string;
	maturity?: 'preview' | 'experimental';
	customKind?: string;
	type?: PositronLanguageModelType;
}

function registration(spec: IRegistrationSpec): IPositronLanguageModelSource {
	return {
		type: spec.type ?? PositronLanguageModelType.Chat,
		provider: {
			id: spec.id,
			displayName: spec.displayName ?? spec.id,
			catalogId: spec.catalogId,
			status: spec.maturity,
			customKind: spec.customKind,
		},
		supportedOptions: [],
		defaults: {},
		signedIn: spec.signedIn,
		status: spec.status,
		statusMessage: spec.statusMessage,
	};
}

describe('getProviderStatus', () => {
	const ctx = createTestContainer().build();

	/** Wires the two services the command reads. */
	function stubServices(options: {
		registrations?: IPositronLanguageModelSource[];
		catalog?: IResolvedProviderData[];
		catalogStatus?: AiProviderServiceStatus;
		/** Registration ids considered enabled; every id is enabled when omitted. */
		enabledIds?: string[];
	} = {}): void {
		const { registrations = [], catalog = [], catalogStatus = 'ready', enabledIds } = options;
		ctx.instantiationService.stub(IAiProviderService, stubInterface<IAiProviderService>({
			whenInitialized: Promise.resolve(),
			status: catalogStatus,
			getProviders: () => catalog,
			getProvider: (id: string) => catalog.find(provider => provider.id === id),
		}));
		ctx.instantiationService.stub(IPositronAssistantConfigurationService, stubInterface<IPositronAssistantConfigurationService>({
			getProviderRegistrations: () => registrations,
			isProviderEnabled: (providerId: string) => enabledIds === undefined || enabledIds.includes(providerId),
		}));
	}

	it('reports a signed-in enabled provider under its catalog id, with the boring fields omitted', async () => {
		stubServices({
			registrations: [registration({ id: 'anthropic-api', catalogId: 'anthropic', displayName: 'Anthropic', signedIn: true, status: 'ok' })],
			catalog: [{ id: 'anthropic', enabled: true, connection: {} }],
		});

		expect(await getProviderStatus(ctx.instantiationService)).toEqual({
			catalogStatus: 'ready',
			// No registration-less providers and at least one registration, so
			// authStateUnavailable is omitted rather than false.
			authStateUnavailable: undefined,
			providers: [{
				id: 'anthropic',
				displayName: 'Anthropic',
				enabled: true,
				auth: 'signed-in',
			}],
		});
	});

	it('pairs an expired credential with its problem text, so it cannot read as a fresh provider', async () => {
		// The authentication extension reports an expired credential with
		// signedIn false and status 'error'. Sign-in state and health are
		// separate fields: without `problem`, this would read as a
		// never-configured provider.
		stubServices({
			registrations: [registration({ id: 'openai-api', catalogId: 'openai', signedIn: false, status: 'error', statusMessage: 'Authentication expired' })],
		});

		const result = await getProviderStatus(ctx.instantiationService);
		expect(result.providers).toEqual([{
			id: 'openai',
			displayName: 'openai-api',
			enabled: true,
			auth: 'not-signed-in',
			problem: 'Authentication expired',
		}]);
	});

	it('keeps a signed-in provider signed in when it reports a configuration problem', async () => {
		// status is provider health, not auth: a working credential against an
		// unreachable custom endpoint reports status 'error' while signedIn is
		// still true. Collapsing that into an auth failure would send the user
		// to re-authenticate, which fixes nothing.
		stubServices({
			registrations: [
				registration({ id: 'custom-gw', signedIn: true, status: 'error', statusMessage: 'Could not reach the configured endpoint' }),
				registration({ id: 'anthropic-api', catalogId: 'anthropic', signedIn: true, status: 'ok' }),
			],
		});

		const result = await getProviderStatus(ctx.instantiationService);
		expect(result.providers.map(({ id, auth, problem }) => ({ id, auth, problem }))).toEqual([
			// The problem entry still leads the ordering, matching the modal's
			// needs-attention grouping.
			{ id: 'custom-gw', auth: 'signed-in', problem: 'Could not reach the configured endpoint' },
			{ id: 'anthropic', auth: 'signed-in', problem: undefined },
		]);
	});

	it('reports a problem with no status text as unspecified rather than dropping it', async () => {
		stubServices({
			registrations: [registration({ id: 'openai-api', catalogId: 'openai', signedIn: false, status: 'error' })],
		});

		expect((await getProviderStatus(ctx.instantiationService)).providers[0].problem).toBe('unspecified');
	});

	it('reports an offered, never-configured provider as not-signed-in', async () => {
		stubServices({
			registrations: [registration({ id: 'gemini-api', catalogId: 'gemini', signedIn: false, status: null })],
		});

		const result = await getProviderStatus(ctx.instantiationService);
		expect(result.providers[0].auth).toBe('not-signed-in');
	});

	it('omits auth entirely for a disabled provider, even when a session lingers', async () => {
		stubServices({
			registrations: [registration({ id: 'copilot-auth', catalogId: 'copilot', signedIn: true, status: 'ok', type: PositronLanguageModelType.Completion })],
			enabledIds: [],
		});

		expect((await getProviderStatus(ctx.instantiationService)).providers).toEqual([{
			id: 'copilot',
			displayName: 'copilot-auth',
			enabled: false,
			completionsOnly: true,
		}]);
	});

	it('carries maturity and custom through from the registration metadata', async () => {
		stubServices({
			registrations: [
				registration({ id: 'snowflake-cortex', maturity: 'preview' }),
				registration({ id: 'My Gateway', customKind: 'anthropic' }),
			],
		});

		const result = await getProviderStatus(ctx.instantiationService);
		expect(result.providers.map(({ id, maturity, custom }) => ({ id, maturity, custom }))).toEqual([
			{ id: 'My Gateway', custom: true },
			{ id: 'snowflake-cortex', maturity: 'preview' },
		]);
	});

	it('reports a catalog entry nothing registered, without inventing sign-in state', async () => {
		stubServices({
			registrations: [registration({ id: 'anthropic-api', catalogId: 'anthropic', signedIn: true, status: 'ok' })],
			catalog: [
				{ id: 'anthropic', enabled: true, connection: {} },
				{ id: 'positai', enabled: false, connection: {} },
			],
		});

		const result = await getProviderStatus(ctx.instantiationService);
		expect(result.providers.find(provider => provider.id === 'positai')).toEqual({
			id: 'positai',
			enabled: false,
		});
		// Sign-in state exists for other providers, so the whole-payload flag stays off.
		expect(result.authStateUnavailable).toBeUndefined();
	});

	it('sets authStateUnavailable only when no provider registered sign-in state at all', async () => {
		stubServices({
			catalog: [{ id: 'anthropic', enabled: true, connection: {} }],
		});

		expect(await getProviderStatus(ctx.instantiationService)).toEqual({
			catalogStatus: 'ready',
			authStateUnavailable: true,
			providers: [{ id: 'anthropic', enabled: true }],
		});
	});

	it('omits auth for a registration the session sweep has not reached, instead of calling it not-signed-in', async () => {
		// During activation, providers are registered before the initial session
		// sweep sets signedIn/status. That window must read as unknown.
		stubServices({
			registrations: [registration({ id: 'anthropic-api', catalogId: 'anthropic' })],
		});

		expect(await getProviderStatus(ctx.instantiationService)).toEqual({
			catalogStatus: 'ready',
			// Registrations exist, but none carries a verdict yet.
			authStateUnavailable: true,
			providers: [{
				id: 'anthropic',
				displayName: 'anthropic-api',
				enabled: true,
			}],
		});
	});

	it('keeps authStateUnavailable off when any registration has been swept, while unswept entries still omit auth', async () => {
		stubServices({
			registrations: [
				registration({ id: 'anthropic-api', catalogId: 'anthropic', signedIn: true, status: 'ok' }),
				registration({ id: 'gemini-api', catalogId: 'gemini' }),
			],
		});

		const result = await getProviderStatus(ctx.instantiationService);
		expect(result.authStateUnavailable).toBeUndefined();
		expect(result.providers.map(({ id, auth }) => ({ id, auth }))).toEqual([
			{ id: 'anthropic', auth: 'signed-in' },
			{ id: 'gemini', auth: undefined },
		]);
	});

	it('passes through the catalog\'s customized-field names without ever carrying connection values', async () => {
		// customizedConnection is computed node-side (diffed against ai-config's
		// built-in defaults); this command must relay the names and never the
		// raw connection the catalog entry still carries.
		stubServices({
			registrations: [registration({ id: 'bedrock-auth', catalogId: 'bedrock', signedIn: true, status: 'ok' })],
			catalog: [{
				id: 'bedrock',
				enabled: true,
				connection: {
					baseUrl: 'https://internal-gateway.example.corp',
					customHeaders: { 'X-Corp-Auth': 'a-secret-token' },
					aws: { profile: 'work' },
				},
				customizedConnection: ['baseUrl', 'customHeaders', 'aws.profile'],
			}],
		});

		const result = await getProviderStatus(ctx.instantiationService);
		expect(result.providers[0].customizedConnection).toEqual(['baseUrl', 'customHeaders', 'aws.profile']);
		// Redaction by construction: no connection value may reach the payload,
		// under any key. The whole serialized result is the honest check.
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain('internal-gateway');
		expect(serialized).not.toContain('a-secret-token');
		expect(serialized).not.toContain('X-Corp-Auth');
		expect(serialized).not.toContain('work');
	});

	it('caps the pass-through problem text to its first line', async () => {
		stubServices({
			registrations: [registration({
				id: 'bedrock-auth', catalogId: 'bedrock', signedIn: false, status: 'error',
				statusMessage: `The security token included in the request is expired (role arn:aws:iam::123456789012:role/x)${'!'.repeat(300)}\n  at SdkError.stack (bundle.js:1:1)`,
			})],
		});

		const message = (await getProviderStatus(ctx.instantiationService)).providers[0].problem!;
		expect(message.endsWith('...')).toBe(true);
		expect(message.length).toBeLessThanOrEqual(200);
		expect(message).not.toContain('SdkError');
	});

	it('joins a registration without a declared catalogId to the catalog by its own id', async () => {
		stubServices({
			registrations: [registration({ id: 'databricks', signedIn: true, status: 'ok' })],
			catalog: [{ id: 'databricks', enabled: true, connection: {}, customizedConnection: ['databricks.host'] }],
		});

		const result = await getProviderStatus(ctx.instantiationService);
		// One entry, not a registration entry plus a catalog-only duplicate.
		expect(result.providers.map(provider => provider.id)).toEqual(['databricks']);
		expect(result.providers[0].customizedConnection).toEqual(['databricks.host']);
	});

	it('marks a catalog-only custom entry as custom', async () => {
		// Reachable when a providers.custom entry exists but nothing registered
		// a source for it (e.g. an Assistant build without custom-provider
		// support). The node side computes `custom`, so the entry is not
		// mistakable for a built-in.
		stubServices({
			registrations: [registration({ id: 'anthropic-api', catalogId: 'anthropic', signedIn: true, status: 'ok' })],
			catalog: [{ id: 'My Gateway', enabled: true, connection: {}, custom: true }],
		});

		const result = await getProviderStatus(ctx.instantiationService);
		expect(result.providers.find(provider => provider.id === 'My Gateway')).toEqual({
			id: 'My Gateway',
			enabled: true,
			custom: true,
		});
	});

	it('orders entries problem reports first, then signed-in, then enabled, then disabled, alphabetically within each band', async () => {
		stubServices({
			registrations: [
				registration({ id: 'zeta', signedIn: true, status: 'ok' }),
				registration({ id: 'alpha', signedIn: false, status: null }),
				registration({ id: 'broken', signedIn: false, status: 'error', statusMessage: 'Authentication expired' }),
				registration({ id: 'beta', signedIn: true, status: 'ok' }),
				registration({ id: 'off', signedIn: false, status: null }),
			],
			enabledIds: ['zeta', 'alpha', 'broken', 'beta'],
		});

		const result = await getProviderStatus(ctx.instantiationService);
		expect(result.providers.map(provider => provider.id)).toEqual(['broken', 'beta', 'zeta', 'alpha', 'off']);
	});

	it('passes a catalog fetch failure through as catalogStatus error', async () => {
		stubServices({ catalogStatus: 'error' });

		const result = await getProviderStatus(ctx.instantiationService);
		expect(result.catalogStatus).toBe('error');
		expect(result.providers).toEqual([]);
	});

	it('reports enablement as unknown, not disabled, when the catalog could not be read', async () => {
		// With an unreadable catalog the enablement snapshot is empty, and
		// isProviderEnabled would answer false for every catalogId-declaring
		// provider. The payload must not launder that into "all providers are
		// disabled": enabled is omitted, and the live sign-in state still shows.
		stubServices({
			registrations: [registration({ id: 'anthropic-api', catalogId: 'anthropic', signedIn: true, status: 'ok' })],
			catalogStatus: 'error',
			enabledIds: [],
		});

		expect(await getProviderStatus(ctx.instantiationService)).toEqual({
			catalogStatus: 'error',
			authStateUnavailable: undefined,
			providers: [{
				id: 'anthropic',
				displayName: 'anthropic-api',
				enabled: undefined,
				auth: 'signed-in',
			}],
		});
	});

	it('treats a catalog still initializing after the bounded wait the same as unreadable', async () => {
		stubServices({
			registrations: [registration({ id: 'anthropic-api', catalogId: 'anthropic', signedIn: false, status: null })],
			catalogStatus: 'initializing',
		});

		const result = await getProviderStatus(ctx.instantiationService);
		expect(result.catalogStatus).toBe('initializing');
		expect(result.providers[0].enabled).toBeUndefined();
		expect(result.providers[0].auth).toBe('not-signed-in');
	});
});
