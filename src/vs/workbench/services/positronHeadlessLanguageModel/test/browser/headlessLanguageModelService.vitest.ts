/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { AsyncIterableObject } from '../../../../../base/common/async.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IProviderCatalogChangeData, IResolvedProviderData } from '../../../../../platform/positronAiProvider/common/aiProviderCatalog.js';
import { IEngineChatRequest, IHeadlessLanguageModelEngine, IModelDescriptor, IProviderMapping } from '../../../../../platform/positronHeadlessLanguageModel/common/engine.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { AiProviderServiceStatus, IAiProviderService } from '../../../positronAiProvider/common/aiProviderService.js';
import { AuthenticationProviderInformation, AuthenticationSession, IAuthenticationService } from '../../../authentication/common/authentication.js';
import { AbstractHeadlessLanguageModelService } from '../../browser/abstractHeadlessLanguageModelService.js';

// A test subclass that hands the facade a fake engine -- the provider-bridge
// boundary. Constructed directly (not via createInstance) with services pulled
// from the container, so the test file avoids DI parameter decorators that the
// vitest transformer cannot parse.
class TestHeadlessLanguageModelService extends AbstractHeadlessLanguageModelService {
	constructor(
		private readonly _fakeEngine: IHeadlessLanguageModelEngine | undefined,
		authService: IAuthenticationService,
		aiProviderService: IAiProviderService,
		logService: ILogService,
	) {
		super(authService, aiProviderService, logService);
	}
	protected createEngine(): IHeadlessLanguageModelEngine | undefined {
		return this._fakeEngine;
	}
}

function model(id: string, name: string, providerId: string, vendor = 'Acme'): IModelDescriptor {
	return { id, name, vendor, providerId };
}

// Stands in for the bridge's PROVIDER_MAP, served by the engine over IPC.
const TEST_MAPPINGS: IProviderMapping[] = [
	{ providerId: 'positai', authProviderId: 'posit-ai', scopes: ['positai'], credentialType: 'oauth', configKey: 'posit-ai' },
	{ providerId: 'anthropic', authProviderId: 'anthropic-api', scopes: [], credentialType: 'apikey', configKey: 'anthropic' },
	{ providerId: 'openai', authProviderId: 'openai-api', scopes: [], credentialType: 'apikey', configKey: 'openai' },
];

// The non-apikey credential types, for the credential-shaping policy tests.
const POLICY_MAPPINGS: IProviderMapping[] = [
	{ providerId: 'vertex', authProviderId: 'vertex-api', scopes: [], credentialType: 'google-cloud', configKey: 'vertex' },
	{ providerId: 'bedrock', authProviderId: 'aws', scopes: [], credentialType: 'aws-credentials', configKey: 'bedrock' },
];

function fakeEngine(options: {
	models?: Record<string, IModelDescriptor[]>;
	mappings?: IProviderMapping[];
	getProviderMappings?: () => Promise<IProviderMapping[]>;
	stream?: (request: IEngineChatRequest) => AsyncIterable<string>;
} = {}): IHeadlessLanguageModelEngine {
	return {
		getProviderMappings: options.getProviderMappings ?? (async () => options.mappings ?? TEST_MAPPINGS),
		listModels: async (providerId: string) => options.models?.[providerId] ?? [],
		streamChat: (request: IEngineChatRequest) =>
			options.stream ? options.stream(request) : AsyncIterableObject.fromArray(['ok']),
	};
}

/** A resolved-catalog provider entry with an optional connection (enabled by default). */
function provider(id: string, connection: IResolvedProviderData['connection'] = {}, enabled = true): IResolvedProviderData {
	return { id, enabled, connection };
}

/** A catalog change event carrying the given flags; the catalog field is unused by the facade. */
function catalogChange(flags: Partial<Omit<IProviderCatalogChangeData, 'catalog'>>): IProviderCatalogChangeData {
	return {
		catalog: [],
		enabledChanged: false,
		connectionChanged: false,
		modelsChanged: false,
		...flags,
	};
}

/** A stream that rejects before its first delta (a provider error at request time). */
function errorStream(): AsyncIterable<string> {
	return { [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('failed before first delta')) }) };
}

/** A stream that never yields and never completes (a model that accepts but stalls). */
function stallStream(): AsyncIterable<string> {
	return { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<string>>(() => { }) }) };
}

async function collect(stream: AsyncIterable<string>): Promise<string> {
	let text = '';
	for await (const chunk of stream) {
		text += chunk;
	}
	return text;
}

function session(authProviderId: string): AuthenticationSession {
	return { id: 's', accessToken: `tok-${authProviderId}`, account: { id: 'a', label: 'a' }, scopes: [] };
}

describe('HeadlessLanguageModelService', () => {
	// Describe-level so the stub captures stable references (builder rule).
	const sessionsChange = new Emitter<{ providerId: string; label: string; event: { added: readonly AuthenticationSession[]; removed: readonly AuthenticationSession[]; changed: readonly AuthenticationSession[] } }>();
	const registerProvider = new Emitter<AuthenticationProviderInformation>();
	const unregisterProvider = new Emitter<AuthenticationProviderInformation>();
	const catalogChangeEmitter = new Emitter<IProviderCatalogChangeData>();
	const createSession = vi.fn();
	const getSessions = vi.fn(async (id: string): Promise<AuthenticationSession[]> => {
		// Simulates getSessions timing out / throwing for a provider that errors.
		if (throwingAuthProviders.has(id)) {
			throw new Error(`Timed out waiting for authentication provider '${id}' to register.`);
		}
		if (!signedInAuthProviders.has(id)) {
			return [];
		}
		// A per-provider access-token override lets credential-shaping tests feed
		// a specific (e.g. malformed JSON) token without re-mocking getSessions.
		const override = sessionTokenOverrides.get(id);
		return [override !== undefined ? { ...session(id), accessToken: override } : session(id)];
	});
	// Registered auth backends (independent of whether a session exists); the
	// facade only queries getSessions for these.
	const getProviderIds = vi.fn((): string[] => [...registeredAuthProviders]);

	// Mutable knobs the stubs read at call time; reset per test.
	let signedInAuthProviders: Set<string>;
	let registeredAuthProviders: Set<string>;
	let throwingAuthProviders: Set<string>;
	// The catalog snapshot the AI provider service reads synchronously, keyed by
	// provider id; providers absent from the map are unknown (disabled).
	let catalogSnapshot: Map<string, IResolvedProviderData>;
	let providerStatus: AiProviderServiceStatus;
	let sessionTokenOverrides: Map<string, string>;

	beforeEach(() => {
		signedInAuthProviders = new Set();
		registeredAuthProviders = new Set(TEST_MAPPINGS.map(mapping => mapping.authProviderId));
		throwingAuthProviders = new Set();
		// The built-in mappings' providers are enabled with no connection overrides
		// by default; individual tests replace this snapshot for shaping/enablement.
		catalogSnapshot = new Map(TEST_MAPPINGS.map(mapping => [mapping.providerId, provider(mapping.providerId)]));
		providerStatus = 'ready';
		sessionTokenOverrides = new Map();
	});

	const ctx = createTestContainer()
		.stub(ILogService, new NullLogService())
		.stub(IAuthenticationService, {
			getSessions, createSession, getProviderIds,
			onDidChangeSessions: sessionsChange.event,
			onDidRegisterAuthenticationProvider: registerProvider.event,
			onDidUnregisterAuthenticationProvider: unregisterProvider.event,
		})
		.stub(IAiProviderService, {
			whenInitialized: Promise.resolve(),
			get status() { return providerStatus; },
			getProvider: (id: string) => catalogSnapshot.get(id),
			isEnabled: (id: string) => catalogSnapshot.get(id)?.enabled === true,
			getProviders: () => [...catalogSnapshot.values()],
			onDidChangeProviders: catalogChangeEmitter.event,
		})
		.build();

	function createService(engine: IHeadlessLanguageModelEngine | undefined): TestHeadlessLanguageModelService {
		return ctx.disposables.add(new TestHeadlessLanguageModelService(
			engine,
			ctx.get(IAuthenticationService),
			ctx.get(IAiProviderService),
			ctx.get(ILogService),
		));
	}

	describe('availability', () => {
		it('reports no-providers-configured when no engine is reachable', async () => {
			const service = createService(undefined);
			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result).toEqual({ available: false, reason: 'no-providers-configured' });
		});

		it('reports sign-in-required when no provider has a session', async () => {
			const service = createService(fakeEngine({ models: { anthropic: [model('haiku-1', 'Haiku', 'anthropic')] } }));
			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result).toEqual({ available: false, reason: 'sign-in-required' });
		});

		it('reports no-model-matched when a pinned exact id is gone (the only no-match path)', async () => {
			signedInAuthProviders.add('anthropic-api');
			const service = createService(fakeEngine({ models: { anthropic: [model('haiku-1', 'Haiku', 'anthropic')] } }));
			const result = await service.streamText({ systemPrompt: 's', messages: [], model: { id: 'nope' } });
			expect(result).toEqual({ available: false, reason: 'no-model-matched' });
		});
	});

	describe('model selection', () => {
		it('default tier resolves via the fast/cheap patterns', async () => {
			signedInAuthProviders.add('anthropic-api');
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));
			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result.available && result.model.id).toBe('claude-haiku');
		});

		it('an exact id resolves precisely', async () => {
			signedInAuthProviders.add('anthropic-api');
			const service = createService(fakeEngine({
				models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic'), model('claude-sonnet', 'Claude Sonnet', 'anthropic')] },
			}));
			const result = await service.streamText({ systemPrompt: 's', messages: [], model: { id: 'claude-sonnet' } });
			expect(result.available && result.model.id).toBe('claude-sonnet');
		});

		it('patterns are tried in order until one matches', async () => {
			signedInAuthProviders.add('openai-api');
			const service = createService(fakeEngine({ models: { openai: [model('gpt-5-mini', 'GPT-5 Mini', 'openai')] } }));
			const result = await service.streamText({ systemPrompt: 's', messages: [], model: { patterns: ['nope', 'mini'] } });
			expect(result.available && result.model.id).toBe('gpt-5-mini');
			expect(result.available && result.usedFallback).toBe(false);
		});
	});

	describe('no-match fallback', () => {
		it('a tier selection falls back to the highest-priority model when its patterns match nothing', async () => {
			signedInAuthProviders.add('openai-api');
			// The default fast/cheap patterns (haiku/mini/flash/gemma) match neither id nor name.
			const service = createService(fakeEngine({ models: { openai: [model('gpt-5', 'GPT-5', 'openai')] } }));
			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result.available && result.model.id).toBe('gpt-5');
			expect(result.available && result.usedFallback).toBe(true);
		});

		it('a pattern selection falls back to the highest-priority model, respecting provider priority', async () => {
			signedInAuthProviders.add('posit-ai');
			signedInAuthProviders.add('anthropic-api');
			const service = createService(fakeEngine({
				models: {
					anthropic: [model('claude-x', 'Claude X', 'anthropic')],
					positai: [model('posit-x', 'Posit X', 'positai')],
				},
			}));
			const result = await service.streamText({ systemPrompt: 's', messages: [], model: { patterns: ['no-such-model'] } });
			// positai (gateway) outranks anthropic, so the fallback lands on its model.
			expect(result.available && result.model.id).toBe('posit-x');
			expect(result.available && result.usedFallback).toBe(true);
		});

		it('the fast/cheap tier uses the built-in default patterns', async () => {
			signedInAuthProviders.add('anthropic-api');
			const service = createService(fakeEngine({
				models: { anthropic: [model('claude-sonnet', 'Claude Sonnet', 'anthropic'), model('claude-haiku', 'Claude Haiku', 'anthropic')] },
			}));
			// The default tier matches the built-in 'haiku' pattern, picking the
			// haiku model over the higher-priority sonnet.
			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result.available && result.model.id).toBe('claude-haiku');
		});
	});

	describe('provider priority', () => {
		it('prefers the Posit gateway over a direct vendor for the same intent', async () => {
			signedInAuthProviders.add('posit-ai');
			signedInAuthProviders.add('anthropic-api');
			const service = createService(fakeEngine({
				models: {
					anthropic: [model('haiku-direct', 'Haiku (direct)', 'anthropic')],
					positai: [model('haiku-posit', 'Haiku (Posit)', 'positai')],
				},
			}));
			const result = await service.streamText({ systemPrompt: 's', messages: [], model: { patterns: ['haiku'] } });
			expect(result.available && result.model.id).toBe('haiku-posit');
		});
	});

	describe('streaming', () => {
		it('streams the engine text deltas through the public result', async () => {
			signedInAuthProviders.add('anthropic-api');
			const service = createService(fakeEngine({
				models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] },
				stream: () => AsyncIterableObject.fromArray(['Hello, ', 'world']),
			}));
			const result = await service.streamText({ systemPrompt: 's', messages: [{ role: 'user', content: 'hi' }] });
			expect(result.available).toBe(true);
			if (result.available) {
				expect(await collect(result.text)).toBe('Hello, world');
			}
		});
	});

	describe('fallback on stall', () => {
		it('falls back to the next candidate when the first fails before its first delta', async () => {
			signedInAuthProviders.add('anthropic-api');
			// Both match the 'haiku' pattern; the first (in listing order) errors
			// before any delta, so the request should land on the second.
			const service = createService(fakeEngine({
				models: { anthropic: [model('haiku-bad', 'Haiku Bad', 'anthropic'), model('haiku-good', 'Haiku Good', 'anthropic')] },
				stream: (request: IEngineChatRequest) =>
					request.modelId === 'haiku-bad' ? errorStream() : AsyncIterableObject.fromArray(['ok']),
			}));
			const result = await service.streamText({ systemPrompt: 's', messages: [], model: { patterns: ['haiku'] } });
			expect(result.available && result.model.id).toBe('haiku-good');
		});

		it('reports temporarily-unavailable when every candidate fails before its first delta', async () => {
			signedInAuthProviders.add('anthropic-api');
			const service = createService(fakeEngine({
				models: { anthropic: [model('haiku-1', 'Haiku One', 'anthropic'), model('haiku-2', 'Haiku Two', 'anthropic')] },
				stream: () => errorStream(),
			}));
			const result = await service.streamText({ systemPrompt: 's', messages: [], model: { patterns: ['haiku'] } });
			expect(result).toEqual({ available: false, reason: 'temporarily-unavailable' });
		});

		it('falls back to the next candidate when the first stalls past the first-delta timeout', async () => {
			vi.useFakeTimers();
			try {
				signedInAuthProviders.add('anthropic-api');
				const service = createService(fakeEngine({
					models: { anthropic: [model('haiku-stall', 'Haiku Stall', 'anthropic'), model('haiku-ok', 'Haiku OK', 'anthropic')] },
					stream: (request: IEngineChatRequest) =>
						request.modelId === 'haiku-stall' ? stallStream() : AsyncIterableObject.fromArray(['ok']),
				}));
				const resultPromise = service.streamText({ systemPrompt: 's', messages: [], model: { patterns: ['haiku'] } });
				// Cross the first-delta timeout so the stalled candidate is abandoned.
				await vi.advanceTimersByTimeAsync(30_000);
				const result = await resultPromise;
				expect(result.available && result.model.id).toBe('haiku-ok');
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe('non-interruption', () => {
		it('never creates a session (no sign-in prompt)', async () => {
			signedInAuthProviders.add('anthropic-api');
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));
			await service.streamText({ systemPrompt: 's', messages: [] });
			await service.getAvailableModels();
			expect(createSession).not.toHaveBeenCalled();
		});
	});

	describe('discovery', () => {
		it('exposes available models with vendor grouping but hides provider identity', async () => {
			signedInAuthProviders.add('anthropic-api');
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic', 'Anthropic')] } }));
			const models = await service.getAvailableModels();
			expect(models).toEqual([{ id: 'claude-haiku', name: 'Claude Haiku', vendor: 'Anthropic' }]);
			expect(models[0]).not.toHaveProperty('providerId');
		});

		it('exposes provider identity and the queried providers through the diagnostics accessor', async () => {
			signedInAuthProviders.add('anthropic-api');
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic', 'Anthropic')] } }));
			expect(await service.getModelListingDiagnostics()).toEqual({
				queriedProviders: ['anthropic'],
				models: [{ id: 'claude-haiku', name: 'Claude Haiku', vendor: 'Anthropic', providerId: 'anthropic' }],
			});
		});

		it('keeps a de-duplicated model visible to diagnostics under both providers', async () => {
			signedInAuthProviders.add('posit-ai');
			signedInAuthProviders.add('anthropic-api');
			const service = createService(fakeEngine({
				models: {
					positai: [model('claude-haiku', 'Claude Haiku', 'positai', 'Anthropic')],
					anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic', 'Anthropic')],
				},
			}));

			// A picker sees the winning copy only.
			expect(await service.getAvailableModels()).toEqual([{ id: 'claude-haiku', name: 'Claude Haiku', vendor: 'Anthropic' }]);

			// Diagnostics sees both, so "anthropic returned nothing" and "anthropic
			// lost the dedupe" don't look the same in the report.
			expect(await service.getModelListingDiagnostics()).toEqual({
				queriedProviders: ['positai', 'anthropic'],
				models: [
					{ id: 'claude-haiku', name: 'Claude Haiku', vendor: 'Anthropic', providerId: 'positai' },
					{ id: 'claude-haiku', name: 'Claude Haiku', vendor: 'Anthropic', providerId: 'anthropic' },
				],
			});
		});

		it('reports a provider that was queried but returned no models', async () => {
			signedInAuthProviders.add('anthropic-api');
			const service = createService(fakeEngine({ models: {} }));
			expect(await service.getModelListingDiagnostics()).toEqual({ queriedProviders: ['anthropic'], models: [] });
		});

		it('fires onDidChangeAvailableModels only when a mapped provider changes', async () => {
			const service = createService(fakeEngine());
			// Provider mappings load from the engine asynchronously; wait for them
			// so the change-event filter is populated before we fire.
			await service.getAvailableModels();
			const fired = vi.fn();
			ctx.disposables.add(service.onDidChangeAvailableModels(fired));

			sessionsChange.fire({ providerId: 'anthropic-api', label: 'a', event: { added: [], removed: [], changed: [] } });
			expect(fired).toHaveBeenCalledTimes(1);

			sessionsChange.fire({ providerId: 'some-unrelated-provider', label: 'b', event: { added: [], removed: [], changed: [] } });
			expect(fired).toHaveBeenCalledTimes(1);
		});
	});

	describe('resilience', () => {
		it('does not query providers whose auth backend is not registered', async () => {
			// Only anthropic-api is registered; posit-ai / openai-api would time
			// out if queried (the deepseek-api regression).
			signedInAuthProviders.add('anthropic-api');
			registeredAuthProviders = new Set(['anthropic-api']);
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));
			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result.available).toBe(true);
			const queried = getSessions.mock.calls.map(call => call[0]);
			expect(queried).not.toContain('posit-ai');
			expect(queried).not.toContain('openai-api');
		});

		it('one provider erroring does not abort the credential sweep', async () => {
			signedInAuthProviders.add('anthropic-api');
			throwingAuthProviders.add('openai-api'); // e.g. an activation timeout
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));
			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result.available && result.model.id).toBe('claude-haiku');
		});
	});

	describe('cancellation', () => {
		it('streamText stops waiting on a hung preflight when the token is cancelled', async () => {
			signedInAuthProviders.add('anthropic-api');
			// An engine whose model listing never resolves (a black-holed IPC call).
			const hangingEngine: IHeadlessLanguageModelEngine = {
				getProviderMappings: async () => TEST_MAPPINGS,
				listModels: () => new Promise<IModelDescriptor[]>(() => { }),
				streamChat: () => AsyncIterableObject.fromArray(['ok']),
			};
			const service = createService(hangingEngine);
			const cts = ctx.disposables.add(new CancellationTokenSource());
			cts.cancel();
			const result = await service.streamText({ systemPrompt: 's', messages: [], cancellationToken: cts.token });
			expect(result).toEqual({ available: false, reason: 'temporarily-unavailable' });
		});
	});

	describe('credentials', () => {
		it('re-resolves credentials for each request even when the model list is cached', async () => {
			signedInAuthProviders.add('anthropic-api');
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));
			await service.getAvailableModels();
			const afterListing = getSessions.mock.calls.length;
			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result.available).toBe(true);
			// The stream request resolved credentials again, beyond the listing pass.
			expect(getSessions.mock.calls.length).toBeGreaterThan(afterListing);
		});
	});

	describe('self-heal on transient failure', () => {
		// An engine whose getProviderMappings rejects the first time and succeeds
		// after, proving both _mappings and _state self-heal rather than caching
		// the rejection forever.
		function rejectThenSucceedEngine(): IHeadlessLanguageModelEngine {
			let calls = 0;
			return fakeEngine({
				models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] },
				getProviderMappings: async () => {
					calls += 1;
					if (calls === 1) {
						throw new Error('bridge not ready');
					}
					return TEST_MAPPINGS;
				},
			});
		}

		it('streamText reports temporarily-unavailable then recovers on retry', async () => {
			signedInAuthProviders.add('anthropic-api');
			const service = createService(rejectThenSucceedEngine());

			const first = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(first).toEqual({ available: false, reason: 'temporarily-unavailable' });

			const second = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(second.available && second.model.id).toBe('claude-haiku');
		});

		it('getAvailableModels returns [] then recovers on retry', async () => {
			signedInAuthProviders.add('anthropic-api');
			const service = createService(rejectThenSucceedEngine());

			expect(await service.getAvailableModels()).toEqual([]);

			const second = await service.getAvailableModels();
			expect(second).toEqual([{ id: 'claude-haiku', name: 'Claude Haiku', vendor: 'Acme' }]);
		});
	});

	describe('cache staleness', () => {
		it('a catalog connection change invalidates the cached model list', async () => {
			signedInAuthProviders.add('anthropic-api');
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));
			// Prime the cache and populate the mapping snapshot the handler reads.
			await service.getAvailableModels();
			const fired = vi.fn();
			ctx.disposables.add(service.onDidChangeAvailableModels(fired));

			// A catalog connection change drops the cache and notifies.
			catalogChangeEmitter.fire(catalogChange({ connectionChanged: true }));
			expect(fired).toHaveBeenCalledTimes(1);

			// The next listing recomputes rather than serving the dropped cache,
			// re-querying sessions for the credential sweep.
			const before = getSessions.mock.calls.length;
			await service.getAvailableModels();
			expect(getSessions.mock.calls.length).toBeGreaterThan(before);
		});

		it('a catalog change that touches neither enablement nor connections does not invalidate', async () => {
			signedInAuthProviders.add('anthropic-api');
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));
			await service.getAvailableModels();
			const fired = vi.fn();
			ctx.disposables.add(service.onDidChangeAvailableModels(fired));

			catalogChangeEmitter.fire(catalogChange({ modelsChanged: true }));
			expect(fired).not.toHaveBeenCalled();
		});

		it('registering a mapped auth provider invalidates the cache and recomputes', async () => {
			// Start with no registered providers: the first listing is empty.
			registeredAuthProviders = new Set();
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));
			expect(await service.getAvailableModels()).toEqual([]);

			const fired = vi.fn();
			ctx.disposables.add(service.onDidChangeAvailableModels(fired));

			// The user signs into anthropic: the backend registers, then a session exists.
			signedInAuthProviders.add('anthropic-api');
			registeredAuthProviders.add('anthropic-api');
			registerProvider.fire({ id: 'anthropic-api', label: 'Anthropic' });
			expect(fired).toHaveBeenCalledTimes(1);

			// The recomputed listing now sees the newly registered, signed-in provider.
			expect(await service.getAvailableModels()).toEqual([{ id: 'claude-haiku', name: 'Claude Haiku', vendor: 'Acme' }]);
		});

		it('registering an unmapped auth provider does not invalidate the cache', async () => {
			const service = createService(fakeEngine());
			await service.getAvailableModels();
			const fired = vi.fn();
			ctx.disposables.add(service.onDidChangeAvailableModels(fired));

			registerProvider.fire({ id: 'some-unrelated-provider', label: 'Other' });
			expect(fired).not.toHaveBeenCalled();
		});
	});

	describe('credential-shaping policy', () => {
		// Captures the shaped credentials the facade hands the engine, so a test
		// can assert the policy (drop on malformed token, region defaulting)
		// rather than re-asserting a full happy-path shape that would rot.
		function capturingEngine(models: Record<string, IModelDescriptor[]>): {
			engine: IHeadlessLanguageModelEngine;
			captured: IEngineChatRequest[];
		} {
			// The non-apikey providers are served by POLICY_MAPPINGS; enable them in
			// the catalog so the enablement filter keeps them (individual tests
			// replace an entry to add connection details).
			catalogSnapshot = new Map(POLICY_MAPPINGS.map(mapping => [mapping.providerId, provider(mapping.providerId)]));
			const captured: IEngineChatRequest[] = [];
			const engine = fakeEngine({
				models,
				mappings: POLICY_MAPPINGS,
				stream: (request: IEngineChatRequest) => {
					captured.push(request);
					return AsyncIterableObject.fromArray(['ok']);
				},
			});
			return { engine, captured };
		}

		it('drops a google-cloud provider whose token is missing project/location', async () => {
			// A malformed blob (no project, no location) shapes to no credential, so
			// the provider is silently dropped -- the support trap the test pins.
			registeredAuthProviders = new Set(['vertex-api']);
			signedInAuthProviders.add('vertex-api');
			sessionTokenOverrides.set('vertex-api', JSON.stringify({ token: 'abc' }));
			const { engine } = capturingEngine({ vertex: [model('gemini', 'Gemini', 'vertex')] });
			const service = createService(engine);

			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result).toEqual({ available: false, reason: 'sign-in-required' });
		});

		it('drops an aws provider whose token is missing accessKeyId/secretAccessKey', async () => {
			registeredAuthProviders = new Set(['aws']);
			signedInAuthProviders.add('aws');
			sessionTokenOverrides.set('aws', JSON.stringify({ accessKeyId: 'AK' }));
			const { engine } = capturingEngine({ bedrock: [model('claude-bedrock', 'Claude (Bedrock)', 'bedrock')] });
			const service = createService(engine);

			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result).toEqual({ available: false, reason: 'sign-in-required' });
		});

		it('defaults the aws region to us-east-1 when the bedrock connection has no aws details', async () => {
			registeredAuthProviders = new Set(['aws']);
			signedInAuthProviders.add('aws');
			sessionTokenOverrides.set('aws', JSON.stringify({ accessKeyId: 'AK', secretAccessKey: 'SK' }));
			const { engine, captured } = capturingEngine({ bedrock: [model('claude-bedrock', 'Claude (Bedrock)', 'bedrock')] });
			const service = createService(engine);

			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result.available).toBe(true);
			expect(captured[0].credentials).toEqual({
				type: 'aws-credentials',
				region: 'us-east-1',
				accessKeyId: 'AK',
				secretAccessKey: 'SK',
				sessionToken: undefined,
				profile: undefined,
			});
		});

	});

	describe('catalog-backed enablement and availability', () => {
		it('excludes a disabled provider from the candidate set', async () => {
			signedInAuthProviders.add('anthropic-api');
			catalogSnapshot.set('anthropic', provider('anthropic', {}, false));
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));

			expect(await service.getAvailableModels()).toEqual([]);
		});

		it('maps a catalog fetch error to temporarily-unavailable, never no-providers-configured', async () => {
			providerStatus = 'error';
			catalogSnapshot = new Map();
			signedInAuthProviders.add('anthropic-api');
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));

			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result).toEqual({ available: false, reason: 'temporarily-unavailable' });
		});

		it('treats an empty catalog with status ready as genuine provider absence', async () => {
			providerStatus = 'ready';
			catalogSnapshot = new Map();
			signedInAuthProviders.add('anthropic-api');
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));

			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result).toEqual({ available: false, reason: 'no-providers-configured' });
		});
	});
});
