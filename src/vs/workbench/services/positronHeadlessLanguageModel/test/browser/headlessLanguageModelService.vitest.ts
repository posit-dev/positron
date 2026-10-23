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
import { IEngineChatRequest, IHeadlessLanguageModelEngine, IModelDescriptor, IModelListing, IProviderMapping } from '../../../../../platform/positronHeadlessLanguageModel/common/engine.js';
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

// Stands in for the provider module's mappings, served by the engine over IPC.
const TEST_MAPPINGS: IProviderMapping[] = [
	{ providerId: 'positai', authProviderId: 'positai', scopes: ['positai'], requiresSession: true },
	{ providerId: 'anthropic', authProviderId: 'anthropic', scopes: [], requiresSession: true },
	{ providerId: 'openai', authProviderId: 'openai', scopes: [], requiresSession: true },
];

function fakeEngine(options: {
	models?: Record<string, IModelDescriptor[]>;
	mappings?: IProviderMapping[];
	getProviderMappings?: () => Promise<IProviderMapping[]>;
	listModels?: (providerId: string, sessionToken: string | undefined) => Promise<IModelListing>;
	stream?: (request: IEngineChatRequest) => AsyncIterable<string>;
} = {}): IHeadlessLanguageModelEngine {
	return {
		getProviderMappings: options.getProviderMappings ?? (async () => options.mappings ?? TEST_MAPPINGS),
		listModels: options.listModels ?? (async (providerId: string) => listing(options.models?.[providerId] ?? [])),
		streamChat: (request: IEngineChatRequest) =>
			options.stream ? options.stream(request) : AsyncIterableObject.fromArray(['ok']),
		getProviderModuleSource: async () => ({ kind: 'compiled-in', reason: 'test' }),
	};
}

function listing(models: IModelDescriptor[] = []): IModelListing {
	return { credentialed: true, models };
}

/** A resolved-catalog provider entry (enabled by default). */
function provider(id: string, enabled = true): IResolvedProviderData {
	return { id, enabled };
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
		return [session(id)];
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

	beforeEach(() => {
		signedInAuthProviders = new Set();
		registeredAuthProviders = new Set(TEST_MAPPINGS.map(mapping => mapping.authProviderId).filter((id): id is string => id !== undefined));
		throwingAuthProviders = new Set();
		// The built-in mappings' providers are enabled by default; individual tests
		// replace this snapshot for enablement.
		catalogSnapshot = new Map(TEST_MAPPINGS.map(mapping => [mapping.providerId, provider(mapping.providerId)]));
		providerStatus = 'ready';
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
			signedInAuthProviders.add('anthropic');
			const service = createService(fakeEngine({ models: { anthropic: [model('haiku-1', 'Haiku', 'anthropic')] } }));
			const result = await service.streamText({ systemPrompt: 's', messages: [], model: { id: 'nope' } });
			expect(result).toEqual({ available: false, reason: 'no-model-matched' });
		});
	});

	describe('model selection', () => {
		it('default tier resolves via the fast/cheap patterns', async () => {
			signedInAuthProviders.add('anthropic');
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));
			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result.available && result.model.id).toBe('claude-haiku');
		});

		it('an exact id resolves precisely', async () => {
			signedInAuthProviders.add('anthropic');
			const service = createService(fakeEngine({
				models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic'), model('claude-sonnet', 'Claude Sonnet', 'anthropic')] },
			}));
			const result = await service.streamText({ systemPrompt: 's', messages: [], model: { id: 'claude-sonnet' } });
			expect(result.available && result.model.id).toBe('claude-sonnet');
		});

		it('patterns are tried in order until one matches', async () => {
			signedInAuthProviders.add('openai');
			const service = createService(fakeEngine({ models: { openai: [model('gpt-5-mini', 'GPT-5 Mini', 'openai')] } }));
			const result = await service.streamText({ systemPrompt: 's', messages: [], model: { patterns: ['nope', 'mini'] } });
			expect(result.available && result.model.id).toBe('gpt-5-mini');
			expect(result.available && result.usedFallback).toBe(false);
		});
	});

	describe('no-match fallback', () => {
		it('a tier selection falls back to the highest-priority model when its patterns match nothing', async () => {
			signedInAuthProviders.add('openai');
			// The default fast/cheap patterns (haiku/mini/flash/gemma) match neither id nor name.
			const service = createService(fakeEngine({ models: { openai: [model('gpt-5', 'GPT-5', 'openai')] } }));
			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result.available && result.model.id).toBe('gpt-5');
			expect(result.available && result.usedFallback).toBe(true);
		});

		it('a pattern selection falls back to the highest-priority model, respecting provider priority', async () => {
			signedInAuthProviders.add('positai');
			signedInAuthProviders.add('anthropic');
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
			signedInAuthProviders.add('anthropic');
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
			signedInAuthProviders.add('positai');
			signedInAuthProviders.add('anthropic');
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
			signedInAuthProviders.add('anthropic');
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
			signedInAuthProviders.add('anthropic');
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
			signedInAuthProviders.add('anthropic');
			const service = createService(fakeEngine({
				models: { anthropic: [model('haiku-1', 'Haiku One', 'anthropic'), model('haiku-2', 'Haiku Two', 'anthropic')] },
				stream: () => errorStream(),
			}));
			const result = await service.streamText({ systemPrompt: 's', messages: [], model: { patterns: ['haiku'] } });
			expect(result).toEqual({ available: false, reason: 'temporarily-unavailable' });
		});

		it('includes the stream error in the warning when a candidate fails before its first delta', async () => {
			signedInAuthProviders.add('anthropic');
			const warn = vi.spyOn(ctx.get(ILogService), 'warn');
			const service = createService(fakeEngine({
				models: { anthropic: [model('haiku-1', 'Haiku One', 'anthropic')] },
				stream: () => errorStream(),
			}));
			await service.streamText({ systemPrompt: 's', messages: [], model: { patterns: ['haiku'] } });
			expect(warn).toHaveBeenCalledWith(expect.stringContaining('Error: failed before first delta'));
		});

		it('falls back to the next candidate when the first stalls past the first-delta timeout', async () => {
			vi.useFakeTimers();
			try {
				signedInAuthProviders.add('anthropic');
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
			signedInAuthProviders.add('anthropic');
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));
			await service.streamText({ systemPrompt: 's', messages: [] });
			await service.getAvailableModels();
			expect(createSession).not.toHaveBeenCalled();
		});
	});

	describe('discovery', () => {
		it('exposes available models with vendor grouping but hides provider identity', async () => {
			signedInAuthProviders.add('anthropic');
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic', 'Anthropic')] } }));
			const models = await service.getAvailableModels();
			expect(models).toEqual([{ id: 'claude-haiku', name: 'Claude Haiku', vendor: 'Anthropic' }]);
			expect(models[0]).not.toHaveProperty('providerId');
		});

		it('exposes provider identity and the queried providers through the diagnostics accessor', async () => {
			signedInAuthProviders.add('anthropic');
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic', 'Anthropic')] } }));
			expect(await service.getModelListingDiagnostics()).toEqual({
				providerModule: { kind: 'compiled-in', reason: 'test' },
				queriedProviders: ['anthropic'],
				models: [{ id: 'claude-haiku', name: 'Claude Haiku', vendor: 'Anthropic', providerId: 'anthropic' }],
			});
		});

		it('keeps a de-duplicated model visible to diagnostics under both providers', async () => {
			signedInAuthProviders.add('positai');
			signedInAuthProviders.add('anthropic');
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
				providerModule: { kind: 'compiled-in', reason: 'test' },
				queriedProviders: ['positai', 'anthropic'],
				models: [
					{ id: 'claude-haiku', name: 'Claude Haiku', vendor: 'Anthropic', providerId: 'positai' },
					{ id: 'claude-haiku', name: 'Claude Haiku', vendor: 'Anthropic', providerId: 'anthropic' },
				],
			});
		});

		it('reports a provider that was queried but returned no models', async () => {
			signedInAuthProviders.add('anthropic');
			const service = createService(fakeEngine({ models: {} }));
			expect(await service.getModelListingDiagnostics()).toEqual({
				providerModule: { kind: 'compiled-in', reason: 'test' },
				queriedProviders: ['anthropic'],
				models: [],
			});
		});

		it('still lists models when the provider module source cannot be read', async () => {
			signedInAuthProviders.add('anthropic');
			const engine = {
				...fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic', 'Anthropic')] } }),
				getProviderModuleSource: async () => { throw new Error('channel closed'); },
			};
			const service = createService(engine);
			expect(await service.getModelListingDiagnostics()).toEqual({
				queriedProviders: ['anthropic'],
				models: [{ id: 'claude-haiku', name: 'Claude Haiku', vendor: 'Anthropic', providerId: 'anthropic' }],
			});
		});

		it('fires onDidChangeAvailableModels only when a mapped provider changes', async () => {
			const service = createService(fakeEngine());
			// Provider mappings load from the engine asynchronously; wait for them
			// so the change-event filter is populated before we fire.
			await service.getAvailableModels();
			const fired = vi.fn();
			ctx.disposables.add(service.onDidChangeAvailableModels(fired));

			sessionsChange.fire({ providerId: 'anthropic', label: 'a', event: { added: [], removed: [], changed: [] } });
			expect(fired).toHaveBeenCalledTimes(1);

			sessionsChange.fire({ providerId: 'some-unrelated-provider', label: 'b', event: { added: [], removed: [], changed: [] } });
			expect(fired).toHaveBeenCalledTimes(1);
		});
	});

	describe('resilience', () => {
		it('does not query providers whose auth backend is not registered', async () => {
			// Only anthropic is registered; positai / openai would time
			// out if queried (the deepseek regression).
			signedInAuthProviders.add('anthropic');
			registeredAuthProviders = new Set(['anthropic']);
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));
			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result.available).toBe(true);
			const queried = getSessions.mock.calls.map(call => call[0]);
			expect(queried).not.toContain('positai');
			expect(queried).not.toContain('openai');
		});

		it('one provider erroring does not abort the credential sweep', async () => {
			signedInAuthProviders.add('anthropic');
			throwingAuthProviders.add('openai'); // e.g. an activation timeout
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));
			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result.available && result.model.id).toBe('claude-haiku');
		});
	});

	describe('cancellation', () => {
		it('streamText stops waiting on a hung preflight when the token is cancelled', async () => {
			signedInAuthProviders.add('anthropic');
			// An engine whose model listing never resolves (a black-holed IPC call).
			const hangingEngine: IHeadlessLanguageModelEngine = {
				getProviderMappings: async () => TEST_MAPPINGS,
				listModels: () => new Promise<IModelListing>(() => { }),
				streamChat: () => AsyncIterableObject.fromArray(['ok']),
				getProviderModuleSource: async () => ({ kind: 'compiled-in', reason: 'test' }),
			};
			const service = createService(hangingEngine);
			const cts = ctx.disposables.add(new CancellationTokenSource());
			cts.cancel();
			const result = await service.streamText({ systemPrompt: 's', messages: [], cancellationToken: cts.token });
			expect(result).toEqual({ available: false, reason: 'temporarily-unavailable' });
		});
	});

	describe('credentials', () => {
		it('re-reads the session for each request even when the model list is cached', async () => {
			signedInAuthProviders.add('anthropic');
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));
			await service.getAvailableModels();
			const afterListing = getSessions.mock.calls.length;
			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result.available).toBe(true);
			// The stream request read the session again, beyond the listing pass.
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
			signedInAuthProviders.add('anthropic');
			const service = createService(rejectThenSucceedEngine());

			const first = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(first).toEqual({ available: false, reason: 'temporarily-unavailable' });

			const second = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(second.available && second.model.id).toBe('claude-haiku');
		});

		it('getAvailableModels returns [] then recovers on retry', async () => {
			signedInAuthProviders.add('anthropic');
			const service = createService(rejectThenSucceedEngine());

			expect(await service.getAvailableModels()).toEqual([]);

			const second = await service.getAvailableModels();
			expect(second).toEqual([{ id: 'claude-haiku', name: 'Claude Haiku', vendor: 'Acme' }]);
		});
	});

	describe('cache staleness', () => {
		it('a catalog connection change invalidates the cached model list', async () => {
			signedInAuthProviders.add('anthropic');
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

		it('a catalog change that touches neither enablement, connections, nor model policy does not invalidate', async () => {
			signedInAuthProviders.add('anthropic');
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));
			await service.getAvailableModels();
			const fired = vi.fn();
			ctx.disposables.add(service.onDidChangeAvailableModels(fired));

			catalogChangeEmitter.fire(catalogChange({}));
			expect(fired).not.toHaveBeenCalled();
		});

		// The provider module applies the policy; the service's job is to drop its
		// cache so the next listing re-queries.
		it('a catalog model policy change invalidates the cached model list', async () => {
			signedInAuthProviders.add('anthropic');
			const listModels = vi.fn().mockResolvedValue(listing([model('claude-opus-5', 'Claude Opus 5', 'anthropic')]));
			const service = createService(fakeEngine({ listModels }));
			await service.getAvailableModels();
			expect(listModels).toHaveBeenCalledTimes(1);
			const fired = vi.fn();
			ctx.disposables.add(service.onDidChangeAvailableModels(fired));

			catalogChangeEmitter.fire(catalogChange({ modelsChanged: true }));
			expect(fired).toHaveBeenCalledTimes(1);
			await service.getAvailableModels();
			expect(listModels).toHaveBeenCalledTimes(2);
		});

		it('registering a mapped auth provider invalidates the cache and recomputes', async () => {
			// Start with no registered providers: the first listing is empty.
			registeredAuthProviders = new Set();
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));
			expect(await service.getAvailableModels()).toEqual([]);

			const fired = vi.fn();
			ctx.disposables.add(service.onDidChangeAvailableModels(fired));

			// The user signs into anthropic: the backend registers, then a session exists.
			signedInAuthProviders.add('anthropic');
			registeredAuthProviders.add('anthropic');
			registerProvider.fire({ id: 'anthropic', label: 'Anthropic' });
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

	describe('session token policy', () => {
		// The provider module lists a session token it cannot shape as
		// uncredentialed, which must still read as a sign-in problem.
		it('reports sign-in-required for an uncredentialed listing', async () => {
			signedInAuthProviders.add('anthropic');
			const service = createService(fakeEngine({ listModels: async () => ({ credentialed: false, models: [] }) }));

			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result).toEqual({ available: false, reason: 'sign-in-required' });
		});

		it('reports no-model-matched for a credentialed listing with no models', async () => {
			signedInAuthProviders.add('anthropic');
			const service = createService(fakeEngine({ listModels: async () => listing() }));

			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result).toEqual({ available: false, reason: 'no-model-matched' });
		});

		it('counts a listing that throws as credentialed with no models', async () => {
			signedInAuthProviders.add('anthropic');
			const service = createService(fakeEngine({ listModels: async () => { throw new Error('gateway down'); } }));

			expect({
				result: await service.streamText({ systemPrompt: 's', messages: [] }),
				diagnostics: await service.getModelListingDiagnostics(),
			}).toEqual({
				result: { available: false, reason: 'no-model-matched' },
				diagnostics: { providerModule: { kind: 'compiled-in', reason: 'test' }, queriedProviders: ['anthropic'], models: [] },
			});
		});

		it('sends the raw session token to listModels', async () => {
			signedInAuthProviders.add('anthropic');
			const listModels = vi.fn(async () => listing());
			const service = createService(fakeEngine({ listModels }));
			await service.getAvailableModels();
			expect(listModels).toHaveBeenCalledWith('anthropic', 'tok-anthropic');
		});

		it('streamText sends the raw session token', async () => {
			signedInAuthProviders.add('anthropic');
			const captured: IEngineChatRequest[] = [];
			const service = createService(fakeEngine({
				models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] },
				stream: request => {
					captured.push(request);
					return AsyncIterableObject.fromArray(['ok']);
				},
			}));
			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result.available).toBe(true);
			expect(captured.map(request => request.sessionToken)).toEqual(['tok-anthropic']);
		});
	});

	describe('catalog-backed enablement and availability', () => {
		it('excludes a disabled provider from the candidate set', async () => {
			signedInAuthProviders.add('anthropic');
			catalogSnapshot.set('anthropic', provider('anthropic', false));
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));

			expect(await service.getAvailableModels()).toEqual([]);
		});

		it('maps a catalog fetch error to temporarily-unavailable, never no-providers-configured', async () => {
			providerStatus = 'error';
			catalogSnapshot = new Map();
			signedInAuthProviders.add('anthropic');
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));

			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result).toEqual({ available: false, reason: 'temporarily-unavailable' });
		});

		it('rejects the diagnostics listing on a catalog failure rather than reporting nothing was queried', async () => {
			providerStatus = 'error';
			catalogSnapshot = new Map();
			signedInAuthProviders.add('anthropic');
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));

			// A picker degrades to an empty list; the report sees the failure.
			expect(await service.getAvailableModels()).toEqual([]);
			await expect(service.getModelListingDiagnostics()).rejects.toThrow('AI provider catalog unavailable');
		});

		it('treats an empty catalog with status ready as genuine provider absence', async () => {
			providerStatus = 'ready';
			catalogSnapshot = new Map();
			signedInAuthProviders.add('anthropic');
			const service = createService(fakeEngine({ models: { anthropic: [model('claude-haiku', 'Claude Haiku', 'anthropic')] } }));

			const result = await service.streamText({ systemPrompt: 's', messages: [] });
			expect(result).toEqual({ available: false, reason: 'no-providers-configured' });
		});
	});

	describe('custom entries', () => {
		const customMapping: IProviderMapping = {
			providerId: 'team-aws', authProviderId: 'custom-providers', scopes: ['team-aws'], requiresSession: true,
		};

		beforeEach(() => {
			registeredAuthProviders = new Set(['custom-providers']);
		});

		it('reads the aggregate session with the entry name as scope and sends its raw token', async () => {
			catalogSnapshot = new Map([['team-aws', { ...provider('team-aws'), custom: true }]]);
			signedInAuthProviders.add('custom-providers');
			const listModels = vi.fn(async () => listing());
			const service = createService(fakeEngine({ mappings: [customMapping], listModels }));
			await service.getAvailableModels();
			expect({ sessions: getSessions.mock.calls, listings: listModels.mock.calls }).toEqual({
				sessions: [['custom-providers', ['team-aws']]],
				listings: [['team-aws', 'tok-custom-providers']],
			});
		});

		it('recomputes mappings after a catalog change so a new custom entry is picked up', async () => {
			let mappings: IProviderMapping[] = [];
			const getProviderMappings = vi.fn(async () => mappings);
			const service = createService(fakeEngine({ getProviderMappings }));
			await service.getAvailableModels();
			mappings = [customMapping];
			catalogChangeEmitter.fire(catalogChange({ enabledChanged: true }));
			await service.getAvailableModels();
			expect(getProviderMappings).toHaveBeenCalledTimes(2);
		});
	});

	describe('local providers', () => {
		const ollamaMapping: IProviderMapping = { providerId: 'ollama', scopes: [], requiresSession: false };

		beforeEach(() => {
			registeredAuthProviders = new Set();
		});

		it('queries a no-session provider without a session token', async () => {
			catalogSnapshot = new Map([['ollama', provider('ollama')]]);
			const listModels = vi.fn(async () => listing());
			const service = createService(fakeEngine({ mappings: [ollamaMapping], listModels }));
			await service.getAvailableModels();
			expect(listModels.mock.calls).toEqual([['ollama', undefined]]);
		});
	});

	describe('no-session providers with an auth provider', () => {
		const foundryMapping: IProviderMapping = {
			providerId: 'ms-foundry', authProviderId: 'ms-foundry', scopes: [], requiresSession: false,
		};

		it('sends a session token when one exists', async () => {
			catalogSnapshot = new Map([['ms-foundry', provider('ms-foundry')]]);
			registeredAuthProviders = new Set(['ms-foundry']);
			signedInAuthProviders.add('ms-foundry');
			const listModels = vi.fn(async () => listing());
			const service = createService(fakeEngine({ mappings: [foundryMapping], listModels }));
			await service.getAvailableModels();
			expect(listModels.mock.calls).toEqual([['ms-foundry', 'tok-ms-foundry']]);
		});
	});
});
