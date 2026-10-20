/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { distinct } from '../../../../base/common/arrays.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { raceCancellation, raceTimeout } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { SelfHealingLazyPromise } from '../../../../base/common/positron/async.js';
import { hasKey } from '../../../../base/common/types.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IAiProviderService } from '../../positronAiProvider/common/aiProviderService.js';
import { AuthenticationSession, IAuthenticationService } from '../../authentication/common/authentication.js';
import { IHeadlessLanguageModelEngine, IModelDescriptor, IModelListing, IProviderMapping } from '../../../../platform/positronHeadlessLanguageModel/common/engine.js';
import {
	FastCheap,
	IAvailableModel,
	IHeadlessLanguageModelService,
	IModelListingDiagnostics,
	IStreamTextRequest,
	ModelSelection,
	StreamTextResult,
	UnavailableReason,
} from '../common/headlessLanguageModelService.js';
import { byPriority, IModelCandidate, ResolvedModelSelection, selectModelCandidates } from '../common/headlessLanguageModelSelection.js';

interface IResolvedState {
	readonly models: readonly IModelDescriptor[];
	/**
	 * Every policy-enabled model each provider returned, before the cross-provider
	 * de-duplication that produces {@link models}. Kept for diagnostics: a
	 * provider whose models all lost the dedupe contributes nothing to `models`,
	 * which otherwise looks identical to the provider having returned nothing at all.
	 */
	readonly allModels: readonly IModelDescriptor[];
	/** Providers actually queried this listing, whether or not they returned models. */
	readonly queriedProviders: readonly string[];
	readonly anyCredential: boolean;
	/** Whether any enabled, registered provider was a candidate at all (vs. genuine absence). */
	readonly anyProvider: boolean;
}

/** A listing call that threw: credentialed, so the provider still counts as signed in. */
const FAILED_LISTING: IModelListing = { credentialed: true, models: [] };

/** No engine, or the listing failed: nothing available, nothing queried. */
const EMPTY_STATE: IResolvedState = { models: [], allModels: [], queriedProviders: [], anyCredential: false, anyProvider: false };

/**
 * Built-in preference patterns for the fast/cheap model tier, tried in order
 * until one matches an available model (case-insensitive). Intentionally not
 * user-configurable yet: a setting for this will return once the
 * ai-provider-bridge / providers.json owns model selection (PR #13730 review).
 */
const FAST_CHEAP_DEFAULT_PATTERNS: readonly string[] = ['haiku', 'mini', 'flash', 'gemma'];

/**
 * How long to wait for a candidate model's first delta before treating it as a
 * stall and moving to the next candidate. Short relative to a consumer's overall
 * budget so a fallback can still complete: a model the gateway lists but can't
 * stream often accepts the request and then never sends anything.
 */
const FIRST_DELTA_TIMEOUT_MS = 10_000;

/**
 * All of the headless-LM policy: model selection, provider priority,
 * typed availability, read-only session lookup (the provider module shapes
 * each raw token into credentials), model-list caching, and change
 * notification. It is environment-agnostic and depends
 * only on two external boundaries -- the auth source and the engine port --
 * which are exactly what the interface tests fake.
 *
 * Subclasses supply the engine via {@link createEngine}; everything else lives
 * here. The concrete subclasses (and their service registrations) live in
 * sibling files so importing this base never registers a service.
 */
export abstract class AbstractHeadlessLanguageModelService extends Disposable implements IHeadlessLanguageModelService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeAvailableModels = this._register(new Emitter<void>());
	readonly onDidChangeAvailableModels: Event<void> = this._onDidChangeAvailableModels.event;

	private _engine: IHeadlessLanguageModelEngine | undefined;
	private _engineCreated = false;
	/**
	 * Provider -> auth mappings, fetched once from the engine (the bridge owns
	 * them). Self-healing so a transient IPC/bridge-startup failure does not
	 * break the service until window reload.
	 */
	private readonly _mappings = new SelfHealingLazyPromise<readonly IProviderMapping[]>(async () => {
		const engine = this.getEngine();
		const mappings = engine ? await engine.getProviderMappings() : [];
		// Synchronous snapshot for the auth/config event filters below.
		this._loadedMappings = mappings;
		return mappings;
	});
	/** Synchronous snapshot of the loaded mappings, for the event filters; set once mappings load. */
	private _loadedMappings: readonly IProviderMapping[] | undefined;
	/**
	 * Cached model listing; invalidated on auth change. Credentials are never
	 * cached. Self-healing so a transient failure does not stick.
	 */
	private readonly _state = new SelfHealingLazyPromise<IResolvedState>(() => this.computeState());

	constructor(
		@IAuthenticationService private readonly _authService: IAuthenticationService,
		@IAiProviderService private readonly _aiProviderService: IAiProviderService,
		@ILogService protected readonly _logService: ILogService,
	) {
		super();
		// The available-model set follows sign-in / sign-out. The mappings
		// load lazily on first use (not here -- a subclass's createEngine depends
		// on parameter-properties not yet assigned during super()). Until they
		// load there is no cached state to invalidate, so an early change is
		// safely ignored by the filter.
		this._register(this._authService.onDidChangeSessions(e => {
			if (this._isMappedAuthProvider(e.providerId)) {
				this._invalidate();
			}
		}));

		// Availability also depends on the resolved provider catalog the provider
		// module shapes credentials from (base URLs, custom headers, AWS
		// region/profile, Snowflake host/account), on each provider's enabled
		// state, and on model policy. A custom entry can appear, disappear, or
		// change kind on any of these, so the mappings (built from the catalog, not
		// just the built-in table) are dropped alongside the cached listing.
		this._register(this._aiProviderService.onDidChangeProviders(e => {
			if (e.enabledChanged || e.connectionChanged || e.modelsChanged) {
				this._mappings.clear();
				this._invalidate();
			}
		}));

		// A mapped auth provider registering (e.g. the user signs into a provider
		// whose backend was not registered at the first lookup) or unregistering
		// changes which providers the sweep queries. Drop the cached state so the
		// next listing reflects the new provider set.
		this._register(this._authService.onDidRegisterAuthenticationProvider(provider => {
			if (this._isMappedAuthProvider(provider.id)) {
				this._invalidate();
			}
		}));
		this._register(this._authService.onDidUnregisterAuthenticationProvider(provider => {
			if (this._isMappedAuthProvider(provider.id)) {
				this._invalidate();
			}
		}));
	}

	/** Drop the cached model listing and notify pickers. */
	private _invalidate(): void {
		this._state.clear();
		this._onDidChangeAvailableModels.fire();
	}

	/** Whether an auth provider id backs a loaded mapping. False until mappings load (nothing cached to invalidate yet). */
	private _isMappedAuthProvider(authProviderId: string): boolean {
		return !!this._loadedMappings?.some(mapping => mapping.authProviderId === authProviderId);
	}

	/** Create the engine for this environment, or `undefined` if none is reachable. */
	protected abstract createEngine(): IHeadlessLanguageModelEngine | undefined;

	private getEngine(): IHeadlessLanguageModelEngine | undefined {
		if (!this._engineCreated) {
			this._engineCreated = true;
			this._engine = this.createEngine();
		}
		return this._engine;
	}

	async streamText(params: IStreamTextRequest): Promise<StreamTextResult> {
		const engine = this.getEngine();
		if (!engine) {
			return { available: false, reason: 'no-providers-configured' };
		}

		const token = params.cancellationToken ?? CancellationToken.None;
		const prepared = await this.prepareCandidates(params.model ?? FastCheap, token);
		if (!prepared.ok) {
			return { available: false, reason: prepared.reason };
		}

		// Try candidates in preference order. A candidate that stalls (accepts the
		// request but streams no first delta before FIRST_DELTA_TIMEOUT_MS) or
		// fails before its first delta is abandoned and the next is tried -- this
		// is what makes the default tier robust to a model the gateway lists but
		// can't actually serve. Each attempt streams under its own token linked to
		// the caller's, so abandoning one cancels just that stream.
		for (const candidate of prepared.candidates) {
			if (token.isCancellationRequested) {
				break;
			}
			const text = await this.attemptStream(engine, candidate.model, params, token);
			if (text) {
				return { available: true, model: { id: candidate.model.id, name: candidate.model.name }, usedFallback: candidate.usedFallback, text };
			}
		}

		// Every candidate stalled or failed before its first delta (or the caller
		// cancelled mid-sweep): retryable rather than a hard no-model-matched.
		return { available: false, reason: 'temporarily-unavailable' };
	}

	/**
	 * Stream one candidate model: read its session freshly, start the
	 * engine stream under a child token linked to the caller's, and wait for the
	 * first delta with a timeout. Returns the stream (first delta re-emitted then
	 * the rest, with the child token source disposed when iteration ends) when a
	 * delta arrives, or `undefined` when the candidate stalls, fails before its
	 * first delta, has no session, or the caller cancels -- the caller then
	 * tries the next candidate. Mid-stream failures after the first delta still
	 * surface through the returned iterable.
	 */
	private async attemptStream(
		engine: IHeadlessLanguageModelEngine,
		model: IModelDescriptor,
		params: IStreamTextRequest,
		token: CancellationToken,
	): Promise<AsyncIterable<string> | undefined> {
		// Read the session freshly for the chosen provider so short-lived tokens
		// stay valid; the model list is from credentialed providers, but a token
		// may have lapsed since listing.
		const session = await raceCancellation(this.resolveSessionFor(model.providerId), token);
		if (token.isCancellationRequested || !session) {
			return undefined;
		}

		const attemptCts = new CancellationTokenSource(token);
		const stream = engine.streamChat({
			providerId: model.providerId,
			modelId: model.id,
			sessionToken: session.sessionToken,
			systemPrompt: params.systemPrompt,
			messages: params.messages,
			maxOutputTokens: params.maxOutputTokens,
		}, attemptCts.token);

		const peeked = await peekFirstDelta(stream, FIRST_DELTA_TIMEOUT_MS);
		if (!hasKey(peeked, { stream: true })) {
			this._logService.warn(`[headless-lm] Model ${model.id} produced no first delta (${peeked.failure}); trying the next candidate.`);
			attemptCts.cancel();
			attemptCts.dispose();
			return undefined;
		}
		return disposeWhenDone(peeked.stream, attemptCts);
	}

	/**
	 * The availability pre-check: resolve the listing state and the ordered model
	 * candidates. It can fail transiently (IPC/bridge startup); that surfaces as
	 * the distinct, retryable `temporarily-unavailable` reason rather than a throw
	 * -- the service's contract is that only the returned `text` iterable throws
	 * mid-stream. Credentials are resolved per attempt (in {@link attemptStream}),
	 * not here, so a stalling candidate can be bypassed without re-listing.
	 */
	private async prepareCandidates(selection: ModelSelection, token: CancellationToken): Promise<
		| { readonly ok: true; readonly candidates: readonly IModelCandidate[] }
		| { readonly ok: false; readonly reason: UnavailableReason }
	> {
		try {
			// Tie the preflight to the request token. The model listing is a shared,
			// self-healing cache, so we don't cancel the computation (that would
			// blow it away for other callers); we just stop waiting on it. A hung
			// listing (black-holed IPC) then surfaces as a transient failure when
			// the caller's token fires instead of keeping the request pending.
			const state = await raceCancellation(this._state.get(), token);
			if (!state) {
				return { ok: false, reason: 'temporarily-unavailable' };
			}
			// No enabled, registered provider at all is genuine absence; an enabled
			// provider with no session is the actionable sign-in case. A catalog
			// fetch failure never reaches here -- computeState throws, landing at
			// the catch below as temporarily-unavailable.
			if (!state.anyProvider) {
				return { ok: false, reason: 'no-providers-configured' };
			}
			if (!state.anyCredential) {
				return { ok: false, reason: 'sign-in-required' };
			}

			const candidates = selectModelCandidates(state.models, this.resolveSelection(selection));
			if (candidates.length === 0) {
				return { ok: false, reason: 'no-model-matched' };
			}
			// A configured pattern set that matched nothing still lands a fallback
			// model, but warn so a misconfigured pattern is diagnosable rather than
			// silently ignored. Keyed on the original selection: a tier's default
			// patterns missing is not a misconfiguration.
			if (candidates[0].usedFallback && hasKey(selection, { patterns: true }) && selection.patterns.length > 0) {
				this._logService.warn(`[headless-lm] Configured model patterns not found: ${JSON.stringify(selection.patterns)}`);
			}
			return { ok: true, candidates };
		} catch (error) {
			this._logService.warn(`[headless-lm] Availability check failed: ${error}`);
			return { ok: false, reason: 'temporarily-unavailable' };
		}
	}

	async getAvailableModels(): Promise<readonly IAvailableModel[]> {
		const state = await this.resolveState();
		return state.models.map(model => ({ id: model.id, name: model.name, vendor: model.vendor }));
	}

	async getModelListingDiagnostics(): Promise<IModelListingDiagnostics> {
		// Not resolveState(): its empty fallback would report a listing failure as
		// "no provider was queried".
		const state = await this._state.get();
		return {
			queriedProviders: state.queriedProviders,
			models: state.allModels.map(model => ({
				id: model.id,
				name: model.name,
				vendor: model.vendor,
				providerId: model.providerId,
			})),
		};
	}

	/**
	 * The cached listing state, or an empty one. A transient failure yields empty
	 * (no accessor here has a reason slot); the state cache self-heals so the next
	 * call can recover.
	 */
	private async resolveState(): Promise<IResolvedState> {
		try {
			return await this._state.get();
		} catch (error) {
			this._logService.warn(`[headless-lm] Listing available models failed: ${error}`);
			return EMPTY_STATE;
		}
	}

	private async computeState(): Promise<IResolvedState> {
		const engine = this.getEngine();
		if (!engine) {
			return EMPTY_STATE;
		}

		// Wait for the catalog snapshot before reading enablement/connection: a
		// listing computed against the pre-init empty snapshot would spuriously
		// exclude every provider. A failed first fetch surfaces as the retryable
		// temporarily-unavailable outcome (the caller's catch), never as genuine
		// absence.
		await this._aiProviderService.whenInitialized;
		if (this._aiProviderService.status === 'error') {
			throw new Error('AI provider catalog unavailable');
		}

		const mappings = await this._mappings.get();

		// Only query providers whose catalog entry is enabled and, when they need a
		// session, whose auth backend is actually registered. Calling getSessions
		// for an unregistered provider would fire its activation event and time out
		// waiting for it to register (e.g. 'deepseek' when the user has no DeepSeek
		// auth) -- both slow and, uncaught, fatal to the whole sweep. The user's
		// real sign-ins are registered, so this loses nothing.
		const registered = new Set(this._authService.getProviderIds());
		const relevant = mappings.filter(mapping =>
			(!mapping.requiresSession || (mapping.authProviderId !== undefined && registered.has(mapping.authProviderId)))
			&& this._aiProviderService.isEnabled(mapping.providerId));

		// Read-only session lookup, then a listing per provider. The provider module
		// shapes each token; an uncredentialed listing is one it could not build a
		// credential for. A listing failure counts as credentialed with no models,
		// so one bad provider does not blank the picker.
		const listings = await Promise.all(relevant.map(async mapping => {
			const session = await this.resolveSession(mapping, registered);
			if (!session) {
				return undefined;
			}
			try {
				return { providerId: mapping.providerId, listing: await engine.listModels(mapping.providerId, session.sessionToken) };
			} catch (error) {
				this._logService.warn(`[headless-lm] Listing models for ${mapping.providerId} failed: ${error}`);
				return { providerId: mapping.providerId, listing: FAILED_LISTING };
			}
		}));
		const credentialed = listings.filter((entry): entry is { providerId: string; listing: IModelListing } =>
			entry?.listing.credentialed === true);

		const allModels = byPriority(credentialed.flatMap(entry => entry.listing.models));
		return {
			models: distinct(allModels, model => model.id),
			allModels,
			queriedProviders: credentialed.map(entry => entry.providerId),
			anyCredential: credentialed.length > 0,
			anyProvider: relevant.length > 0,
		};
	}

	/**
	 * Resolve a selection for the selector: a tier becomes its built-in
	 * preference patterns; an id or pattern selection passes through unchanged.
	 */
	private resolveSelection(selection: ModelSelection): ResolvedModelSelection {
		if (!hasKey(selection, { tier: true })) {
			return selection;
		}
		return { patterns: FAST_CHEAP_DEFAULT_PATTERNS };
	}

	/** Resolve the session for a provider id, looking up its mapping first. */
	private async resolveSessionFor(providerId: string): Promise<{ sessionToken: string | undefined } | undefined> {
		const mapping = (await this._mappings.get()).find(m => m.providerId === providerId);
		return mapping ? this.resolveSession(mapping, new Set(this._authService.getProviderIds())) : undefined;
	}

	/** `undefined` means skip the provider; `{ sessionToken: undefined }` means query it without a session. Never creates a session. */
	private async resolveSession(mapping: IProviderMapping, registered: ReadonlySet<string>): Promise<{ sessionToken: string | undefined } | undefined> {
		const sessionToken = mapping.authProviderId !== undefined && registered.has(mapping.authProviderId)
			? await this.readAccessToken(mapping.authProviderId, mapping.scopes)
			: undefined;
		if (sessionToken === undefined && mapping.requiresSession) {
			return undefined;
		}
		return { sessionToken };
	}

	/** Silent session lookup for the mapping's scopes. */
	private async readAccessToken(authProviderId: string, scopes: readonly string[]): Promise<string | undefined> {
		const sessions = await this.tryGetSessions(authProviderId, [...scopes]);
		return sessions[0]?.accessToken;
	}

	/**
	 * Session lookup that never throws -- mirrors the bridge's tryGetSession. A
	 * provider that errors (or whose activation times out despite being listed as
	 * registered) yields no session rather than aborting the credential sweep.
	 */
	private async tryGetSessions(authProviderId: string, scopes: string[]): Promise<readonly AuthenticationSession[]> {
		try {
			return await this._authService.getSessions(authProviderId, scopes);
		} catch (error) {
			this._logService.trace(`[headless-lm] No session for ${authProviderId}: ${error}`);
			return [];
		}
	}
}

/**
 * Start consuming a stream and wait for its first delta, bounded by `timeoutMs`.
 * Returns a stream that re-emits that first delta and then the rest when one
 * arrives (or an empty stream if the model completes with no delta -- a valid
 * empty response). Returns a `failure` description when no first delta arrives
 * in time (a stall) or the stream fails before producing one. A failure *after*
 * the first delta is left to surface through the returned iterable.
 */
async function peekFirstDelta(
	stream: AsyncIterable<string>,
	timeoutMs: number,
): Promise<{ readonly stream: AsyncIterable<string> } | { readonly failure: string }> {
	const iterator = stream[Symbol.asyncIterator]();
	let first: IteratorResult<string>;
	try {
		// iterator.next() always resolves to an IteratorResult, never undefined,
		// so an undefined race result unambiguously means the timeout won.
		const result = await raceTimeout(Promise.resolve(iterator.next()), timeoutMs);
		if (result === undefined) {
			return { failure: `no delta within ${timeoutMs}ms` };
		}
		first = result;
	} catch (error) {
		return { failure: String(error) };
	}
	const replay = (async function* () {
		if (first.done) {
			return;
		}
		yield first.value;
		while (true) {
			const next = await iterator.next();
			if (next.done) {
				return;
			}
			yield next.value;
		}
	})();
	return { stream: replay };
}

/** Re-yield a stream, disposing `cts` once iteration ends (completes, throws, or is abandoned). */
function disposeWhenDone(stream: AsyncIterable<string>, cts: CancellationTokenSource): AsyncIterable<string> {
	return (async function* () {
		try {
			yield* stream;
		} finally {
			cts.dispose();
		}
	})();
}
