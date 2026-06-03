/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { hasKey } from '../../../../../base/common/types.js';
import { IChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { AuthenticationSession, AuthenticationSessionsChangeEvent, IAuthenticationService } from '../../../../services/authentication/common/authentication.js';
import { AbstractPositronLMService, AUTH_PROVIDER_MAP, matchModelFromCache, PROVIDER_PRIORITY } from '../../common/positronLMServiceImpl.js';
import { IpcModelInfo, IpcStreamEvent, IpcStreamTextArgs } from '../../common/positronLMService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeModel(id: string, providerId: string, name?: string): IpcModelInfo {
	return { id, providerId, name };
}

function makeCache(entries: Array<[string, IpcModelInfo[]]>): Map<string, IpcModelInfo[]> {
	return new Map(entries);
}

// ---------------------------------------------------------------------------
// PROVIDER_PRIORITY
// ---------------------------------------------------------------------------

describe('PROVIDER_PRIORITY', () => {
	it('includes all expected providers in order', () => {
		expect(PROVIDER_PRIORITY).toEqual([
			'positai',
			'anthropic',
			'openai',
			'gemini',
			'deepseek',
			'copilot',
			'bedrock',
			'openai-compatible',
		]);
	});
});

// ---------------------------------------------------------------------------
// matchModelFromCache
// ---------------------------------------------------------------------------

describe('matchModelFromCache', () => {
	it('returns null when cache is empty', () => {
		const result = matchModelFromCache(new Map(), ['haiku']);
		expect(result).toBeNull();
	});

	it('matches first preference pattern against highest-priority provider', () => {
		const cache = makeCache([
			['anthropic', [makeModel('claude-3-haiku-20240307', 'anthropic', 'Claude 3 Haiku')]],
			['openai', [makeModel('gpt-4o-mini', 'openai', 'GPT-4o mini')]],
		]);

		const result = matchModelFromCache(cache, ['haiku', 'mini']);
		expect(result).toEqual({ model: makeModel('claude-3-haiku-20240307', 'anthropic', 'Claude 3 Haiku'), providerId: 'anthropic' });
	});

	it('falls through to next pattern when first pattern has no match', () => {
		const cache = makeCache([
			['anthropic', [makeModel('claude-3-5-sonnet-20241022', 'anthropic', 'Claude 3.5 Sonnet')]],
			['openai', [makeModel('gpt-4o-mini', 'openai', 'GPT-4o mini')]],
		]);

		const result = matchModelFromCache(cache, ['haiku', 'mini']);
		expect(result).toEqual({ model: makeModel('gpt-4o-mini', 'openai', 'GPT-4o mini'), providerId: 'openai' });
	});

	it('returns fallback from highest-priority provider when no patterns match', () => {
		const cache = makeCache([
			['openai', [makeModel('gpt-4o', 'openai', 'GPT-4o')]],
			['anthropic', [makeModel('claude-3-5-sonnet-20241022', 'anthropic', 'Claude 3.5 Sonnet')]],
		]);

		const result = matchModelFromCache(cache, ['haiku']);
		expect(result).toEqual({ model: makeModel('claude-3-5-sonnet-20241022', 'anthropic', 'Claude 3.5 Sonnet'), providerId: 'anthropic' });
	});

	it('matches case-insensitively against model id', () => {
		const cache = makeCache([
			['openai', [makeModel('GPT-4O-MINI', 'openai')]],
		]);

		const result = matchModelFromCache(cache, ['gpt-4o-mini']);
		expect(result).toEqual({ model: makeModel('GPT-4O-MINI', 'openai'), providerId: 'openai' });
	});

	it('skips empty and whitespace-only patterns', () => {
		const cache = makeCache([
			['anthropic', [makeModel('claude-3-haiku-20240307', 'anthropic', 'Claude 3 Haiku')]],
		]);

		const result = matchModelFromCache(cache, ['', '   ', 'haiku']);
		expect(result).toEqual({ model: makeModel('claude-3-haiku-20240307', 'anthropic', 'Claude 3 Haiku'), providerId: 'anthropic' });
	});

	it('respects provider priority when same model pattern exists in multiple providers', () => {
		const cache = makeCache([
			['openai', [makeModel('gpt-4o-mini-fast', 'openai', 'GPT-4o Mini Fast')]],
			['anthropic', [makeModel('claude-haiku-fast', 'anthropic', 'Claude Haiku Fast')]],
		]);

		const result = matchModelFromCache(cache, ['fast']);
		expect(result?.providerId).toBe('anthropic');
	});

	it('returns null when cache has entries but all providers have empty model lists', () => {
		const cache = makeCache([
			['anthropic', []],
			['openai', []],
		]);

		const result = matchModelFromCache(cache, ['haiku']);
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// AUTH_PROVIDER_MAP <-> ai-provider-bridge PROVIDER_MAP sync
// ---------------------------------------------------------------------------

describe('AUTH_PROVIDER_MAP stays in sync with ai-provider-bridge', () => {
	it('each entry maps to the same authProviderId and credentialType as the bridge', async () => {
		// eslint-disable-next-line local/code-amd-node-module -- vitest runs in Node ESM; importAMDNodeModule is unavailable
		const { PROVIDER_MAP } = await import('ai-provider-bridge');
		for (const [authProviderId, mapping] of AUTH_PROVIDER_MAP) {
			const bridgeEntry = PROVIDER_MAP[mapping.providerId as keyof typeof PROVIDER_MAP];
			expect(bridgeEntry, `providerId "${mapping.providerId}" is missing from bridge PROVIDER_MAP`).toBeDefined();
			expect(bridgeEntry.authProviderId, `providerId "${mapping.providerId}" authProviderId mismatch`).toBe(authProviderId);
			expect(bridgeEntry.credentialType, `providerId "${mapping.providerId}" credentialType mismatch`).toBe(mapping.type);
			expect(bridgeEntry.scopes, `providerId "${mapping.providerId}" scopes mismatch`).toEqual(mapping.scopes ?? []);
			expect(bridgeEntry.fallbackScopes, `providerId "${mapping.providerId}" fallbackScopes mismatch`).toEqual(mapping.fallbackScopes);
		}
	});

	it('every PROVIDER_PRIORITY entry has an AUTH_PROVIDER_MAP entry', () => {
		const mappedProviderIds = new Set(
			Array.from(AUTH_PROVIDER_MAP.values()).map(m => m.providerId)
		);
		for (const providerId of PROVIDER_PRIORITY) {
			expect(mappedProviderIds.has(providerId), `${providerId} is in PROVIDER_PRIORITY but has no AUTH_PROVIDER_MAP entry`).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// AbstractPositronLMService -- streamText, credential resolution, sign-out
// ---------------------------------------------------------------------------

/**
 * Concrete subclass that accepts the IPC channel directly. The shipped
 * browser/node/electron subclasses derive the channel from a remote connection;
 * this one lets a test drive the transport without a real shared process.
 */
class TestPositronLMService extends AbstractPositronLMService {
	constructor(
		channel: IChannel | null,
		@ILogService logService: ILogService,
		@IAuthenticationService authenticationService: IAuthenticationService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super(channel, logService, authenticationService, configurationService);
	}
}

function makeSession(accessToken: string): AuthenticationSession {
	return { id: 'session', accessToken, account: { id: 'acc', label: 'Account' }, scopes: [] };
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
	const chunks: string[] = [];
	for await (const chunk of stream) {
		chunks.push(chunk);
	}
	return chunks;
}

describe('AbstractPositronLMService', () => {
	const haiku: IpcModelInfo = { id: 'claude-3-haiku', name: 'Claude 3 Haiku', providerId: 'anthropic' };

	// Per-test config, reset in beforeEach and read by the stub/channel closures.
	let sessions: Map<string, AuthenticationSession[]>;
	let models: Map<string, IpcModelInfo[]>;
	let modelsRewarm: Map<string, IpcModelInfo[]> | undefined;
	let getModelsCalls: Map<string, number>;
	let getSessionsCalls: Array<{ id: string; scopes?: readonly string[] }>;
	let getSessionsOverride: ((id: string, scopes?: readonly string[]) => Promise<ReadonlyArray<AuthenticationSession>>) | undefined;
	let providerIds: string[] | undefined;
	let streamEvents: IpcStreamEvent[];
	let lastStreamArgs: IpcStreamTextArgs | undefined;
	let streamSubDisposed: boolean;

	// Created once at describe scope so the stub captures this exact .event
	// during build(); a per-test emitter would not fire on the built service.
	// Per-test services unsubscribe on afterEach disposal, so only the current
	// test's service reacts -- do not fire this across test boundaries.
	const onDidChangeSessions = new Emitter<{ providerId: string; label: string; event: AuthenticationSessionsChangeEvent }>();

	beforeEach(() => {
		sessions = new Map();
		models = new Map();
		modelsRewarm = undefined;
		getModelsCalls = new Map();
		getSessionsCalls = [];
		getSessionsOverride = undefined;
		providerIds = undefined;
		streamEvents = [{ type: 'end' }];
		lastStreamArgs = undefined;
		streamSubDisposed = false;
	});

	const ctx = createTestContainer()
		.stub(ILogService, new NullLogService())
		.stub(IAuthenticationService, {
			getProviderIds: () => providerIds ?? Array.from(sessions.keys()),
			getSessions: (id: string, scopes?: readonly string[]) => {
				getSessionsCalls.push({ id, scopes });
				return getSessionsOverride?.(id, scopes) ?? Promise.resolve(sessions.get(id) ?? []);
			},
			onDidChangeSessions: onDidChangeSessions.event,
		})
		.stub(IConfigurationService, new TestConfigurationService({
			'languageModels.fastcheap': ['haiku'],
			'authentication.aws.credentials': { AWS_REGION: 'eu-west-1' },
			'authentication.openai-compatible.baseUrl': 'https://models.example.test/v1',
			'authentication.openai-compatible.customHeaders': { 'x-router': 'east' },
		}))
		.build();

	/**
	 * A transport channel backed by the per-test `models` (for getModels) and
	 * `streamEvents` (replayed to the streamText listener on the next microtask,
	 * mirroring how the shared process pushes chunks back). Captures the
	 * streamText args so credential tests can assert what was forwarded.
	 */
	function makeChannel(): IChannel {
		return {
			// IChannel's call/listen are generic; this double only ever answers
			// 'getModels'/'streamText', so it bridges the concrete values back to
			// the caller's T.
			call<T>(command: string, arg?: { providerId: string }): Promise<T> {
				if (command !== 'getModels') {
					return Promise.resolve(undefined as unknown as T);
				}
				// Serve `modelsRewarm` from the 2nd getModels call onward, so a test
				// can make a model appear only after streamText's re-warm retry.
				const providerId = arg!.providerId;
				const calls = (getModelsCalls.get(providerId) ?? 0) + 1;
				getModelsCalls.set(providerId, calls);
				const table = calls >= 2 && modelsRewarm ? modelsRewarm : models;
				return Promise.resolve((table.get(providerId) ?? []) as unknown as T);
			},
			listen<T>(event: string, arg?: unknown): Event<T> {
				if (event === 'streamText') {
					lastStreamArgs = arg as IpcStreamTextArgs;
				}
				const events = streamEvents;
				const ev: Event<IpcStreamEvent> = listener => {
					queueMicrotask(() => events.forEach(e => listener(e)));
					return { dispose() { streamSubDisposed = true; } };
				};
				return ev as unknown as Event<T>;
			},
		};
	}

	function makeService(channelMode: 'channel' | 'none' = 'channel'): AbstractPositronLMService {
		const channel = channelMode === 'none' ? null : makeChannel();
		return ctx.disposables.add(ctx.instantiationService.createInstance(TestPositronLMService, channel));
	}

	describe('streamText', () => {
		it('reports no-providers when there is no transport channel', async () => {
			const result = await makeService('none').streamText({ systemPrompt: '', messages: [] });
			expect(result).toEqual({ failure: 'no-providers' });
		});

		it('reports no-providers when the cache is empty and no auth providers exist', async () => {
			const result = await makeService().streamText({ systemPrompt: '', messages: [] });
			expect(result).toEqual({ failure: 'no-providers' });
		});

		it('reports auth-required when the cache is empty but auth providers exist', async () => {
			// Provider registered but signed out: getSessions returns nothing, so
			// the cache stays empty while getProviderIds is non-empty.
			providerIds = ['anthropic-api'];
			const result = await makeService().streamText({ systemPrompt: '', messages: [] });
			expect(result).toEqual({ failure: 'auth-required' });
		});

		it('reports no-match when a requested model id is not available', async () => {
			sessions.set('anthropic-api', [makeSession('sk')]);
			models.set('anthropic', [haiku]);
			const result = await makeService().streamText({ systemPrompt: '', messages: [], model: { id: 'gpt-imaginary' } });
			expect(result).toEqual({ failure: 'no-match' });
		});

		it('streams the provider chunks and resolves the model name on success', async () => {
			sessions.set('anthropic-api', [makeSession('sk')]);
			models.set('anthropic', [haiku]);
			streamEvents = [{ type: 'data', text: 'Hello' }, { type: 'data', text: ', world' }, { type: 'end' }];

			const result = await makeService().streamText({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }] });
			if (hasKey(result, { failure: true })) { throw new Error(`expected a stream, got failure: ${result.failure}`); }

			expect({ chunks: await collect(result.stream), modelName: result.modelName })
				.toEqual({ chunks: ['Hello', ', world'], modelName: 'Claude 3 Haiku' });
		});

		it('rejects the consumer stream when the channel emits an error event', async () => {
			sessions.set('anthropic-api', [makeSession('sk')]);
			models.set('anthropic', [haiku]);
			streamEvents = [{ type: 'data', text: 'partial' }, { type: 'error', message: 'provider exploded' }];

			const result = await makeService().streamText({ systemPrompt: '', messages: [] });
			if (hasKey(result, { failure: true })) { throw new Error(`expected a stream, got failure: ${result.failure}`); }

			await expect(collect(result.stream)).rejects.toThrow('provider exploded');
		});

		it('recovers via an on-demand re-warm when a model appears after activation', async () => {
			const other: IpcModelInfo = { id: 'other-model', providerId: 'anthropic' };
			sessions.set('anthropic-api', [makeSession('sk')]);
			models.set('anthropic', [other]);                        // first warm: target absent
			modelsRewarm = new Map([['anthropic', [other, haiku]]]); // re-warm: target now present
			streamEvents = [{ type: 'data', text: 'ok' }, { type: 'end' }];

			const result = await makeService().streamText({ systemPrompt: '', messages: [], model: { id: 'claude-3-haiku' } });
			if (hasKey(result, { failure: true })) { throw new Error(`expected a stream, got failure: ${result.failure}`); }

			expect({ chunks: await collect(result.stream), modelName: result.modelName })
				.toEqual({ chunks: ['ok'], modelName: 'Claude 3 Haiku' });
		});

		it('tears down the stream subscription when the cancellation token is cancelled', async () => {
			sessions.set('anthropic-api', [makeSession('sk')]);
			models.set('anthropic', [haiku]);
			streamEvents = [{ type: 'data', text: 'partial' }]; // no 'end' -- the stream stays open

			const cts = ctx.disposables.add(new CancellationTokenSource());
			const result = await makeService().streamText({ systemPrompt: '', messages: [], cancellationToken: cts.token });
			if (hasKey(result, { failure: true })) { throw new Error(`expected a stream, got failure: ${result.failure}`); }

			const collected = collect(result.stream); // would hang forever without the cancellation wiring
			cts.cancel();

			await collected;                          // resolves only because cancellation ends the iteration
			expect(streamSubDisposed).toBe(true);     // and the IPC subscription was torn down
		});
	});

	describe('credential resolution', () => {
		// Drives a successful streamText so the channel captures the credentials
		// the service resolved and forwarded.
		async function forwardedCredentials(): Promise<IpcStreamTextArgs['credentials']> {
			const result = await makeService().streamText({ systemPrompt: '', messages: [] });
			if (hasKey(result, { failure: true })) { throw new Error(`expected a stream, got failure: ${result.failure}`); }
			await collect(result.stream);
			return lastStreamArgs!.credentials;
		}

		it('forwards an api key for an api-key provider', async () => {
			sessions.set('anthropic-api', [makeSession('sk-anthropic')]);
			models.set('anthropic', [haiku]);
			expect(await forwardedCredentials()).toEqual({ type: 'apikey', apiKey: 'sk-anthropic' });
		});

		it('forwards an access token for an oauth provider', async () => {
			sessions.set('posit-ai', [makeSession('oauth-token')]);
			models.set('positai', [{ id: 'positron-model', providerId: 'positai' }]);
			expect(await forwardedCredentials()).toEqual({ type: 'oauth', accessToken: 'oauth-token' });
			expect(getSessionsCalls.some(call => call.id === 'posit-ai' && call.scopes?.join(',') === 'positai')).toBe(true);
		});

		it('parses AWS credentials and applies the configured region for a bedrock provider', async () => {
			sessions.set('amazon-bedrock', [makeSession(JSON.stringify({
				accessKeyId: 'AKIA', secretAccessKey: 'secret', sessionToken: 'token',
			}))]);
			models.set('bedrock', [{ id: 'bedrock-model', providerId: 'bedrock' }]);
			expect(await forwardedCredentials()).toEqual({
				type: 'aws-credentials', region: 'eu-west-1',
				accessKeyId: 'AKIA', secretAccessKey: 'secret', sessionToken: 'token',
			});
		});

		it('forwards configured base URL and custom headers for api-key providers', async () => {
			sessions.set('openai-compatible', [makeSession('sk-custom')]);
			models.set('openai-compatible', [{ id: 'custom-fast', providerId: 'openai-compatible' }]);
			expect(await forwardedCredentials()).toEqual({
				type: 'apikey',
				apiKey: 'sk-custom',
				baseUrl: 'https://models.example.test/v1',
				customHeaders: { 'x-router': 'east' },
			});
		});

		it('tries Copilot fallback scopes when the primary scope has no session', async () => {
			sessions.set('github', [makeSession('gh-token')]);
			models.set('copilot', [{ id: 'copilot-fast', providerId: 'copilot' }]);
			getSessionsOverride = (id, scopes) => {
				if (id === 'github' && scopes?.join(',') === 'read:user') {
					return Promise.resolve([]);
				}
				return Promise.resolve(sessions.get(id) ?? []);
			};

			expect(await forwardedCredentials()).toEqual({ type: 'apikey', apiKey: 'gh-token' });
			expect(getSessionsCalls.filter(call => call.id === 'github').map(call => call.scopes)).toEqual([
				['read:user'],
				['read:user', 'user:email', 'repo', 'workflow'],
			]);
		});
	});

	describe('sign-out graceful degradation', () => {
		// Fires the sign-out for `authProviderId` after removing its session, and
		// resolves once the service has refreshed its model list in response.
		async function signOut(service: AbstractPositronLMService, authProviderId: string): Promise<void> {
			const refreshed = Event.toPromise(service.onDidChangeAvailableModels);
			sessions.delete(authProviderId);
			onDidChangeSessions.fire({ providerId: authProviderId, label: authProviderId, event: { added: undefined, removed: [makeSession('x')], changed: undefined } });
			await refreshed;
		}

		it('removes models for a provider whose session was removed', async () => {
			sessions.set('anthropic-api', [makeSession('sk')]);
			models.set('anthropic', [haiku]);

			const service = makeService();
			await Event.toPromise(service.onDidChangeAvailableModels); // initial cache warm
			expect(service.availableModels.map(m => m.id)).toEqual(['claude-3-haiku']);

			await signOut(service, 'anthropic-api');
			expect(service.availableModels).toEqual([]);
		});

		it('keeps other providers models when one provider signs out', async () => {
			sessions.set('anthropic-api', [makeSession('sk')]);
			sessions.set('posit-ai', [makeSession('tok')]);
			models.set('anthropic', [haiku]);
			models.set('positai', [{ id: 'positron-model', name: 'Positron', providerId: 'positai' }]);

			const service = makeService();
			await Event.toPromise(service.onDidChangeAvailableModels); // initial cache warm

			await signOut(service, 'anthropic-api');
			expect(service.availableModels.map(m => m.id)).toEqual(['positron-model']);
		});
	});
});
