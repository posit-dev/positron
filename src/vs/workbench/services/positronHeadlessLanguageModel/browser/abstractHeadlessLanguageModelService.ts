/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { distinct } from '../../../../base/common/arrays.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { raceCancellation } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { SelfHealingLazyPromise } from '../../../../base/common/positron/async.js';
import { hasKey } from '../../../../base/common/types.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { AuthenticationSession, IAuthenticationService } from '../../authentication/common/authentication.js';
import {
	FAST_CHEAP_DEFAULT_PATTERNS,
	TIER_SETTING_KEYS,
} from '../common/headlessLanguageModelConfiguration.js';
import { ICredentials, IHeadlessLanguageModelEngine, IModelDescriptor, IProviderMapping } from '../../../../platform/positronHeadlessLanguageModel/common/engine.js';
import {
	FastCheap,
	IAvailableModel,
	IHeadlessLanguageModelService,
	IStreamTextRequest,
	ModelSelection,
	StreamTextResult,
	UnavailableReason,
} from '../common/headlessLanguageModelService.js';
import { byPriority, ResolvedModelSelection, selectModel } from '../common/headlessLanguageModelSelection.js';
import { type CredentialConfig, shapeCredentials } from 'ai-provider-bridge/credential-shaping';

interface IResolvedState {
	readonly models: readonly IModelDescriptor[];
	readonly anyCredential: boolean;
}

/**
 * All of the headless-LM policy: model selection, provider priority,
 * typed availability, read-only credential resolution, model-list
 * caching, and change notification. It is environment-agnostic and depends
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
		@IConfigurationService private readonly _configService: IConfigurationService,
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

		// Availability also depends on per-provider config the credential shaping
		// reads (base URLs, custom headers, AWS region, Snowflake host/account).
		// A change to any of those keys can flip a provider's availability or the
		// listed models, so the cached state must be dropped. Same guard as
		// above: if mappings have not loaded there is no state to invalidate.
		this._register(this._configService.onDidChangeConfiguration(e => {
			if (this.affectsCredentialConfig(e)) {
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

	/**
	 * Whether a config change touches any key the credential shaping reads for a
	 * loaded mapping: each apikey mapping's `authentication.<configKey>.baseUrl` /
	 * `.customHeaders`, plus the fixed `authentication.aws.credentials` and
	 * `authentication.snowflake.credentials` namespaces. Returns false until
	 * mappings load (nothing cached to invalidate yet).
	 */
	private affectsCredentialConfig(e: IConfigurationChangeEvent): boolean {
		const mappings = this._loadedMappings;
		if (!mappings) {
			return false;
		}
		if (e.affectsConfiguration('authentication.aws.credentials')
			|| e.affectsConfiguration('authentication.snowflake.credentials')) {
			return true;
		}
		return mappings.some(mapping =>
			e.affectsConfiguration(`authentication.${mapping.configKey}.baseUrl`)
			|| e.affectsConfiguration(`authentication.${mapping.configKey}.customHeaders`));
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
		const prepared = await this.prepareRequest(params.model ?? FastCheap, token);
		if (!prepared.ok) {
			return { available: false, reason: prepared.reason };
		}

		// streamChat returns its iterable synchronously, so it stays outside the
		// pre-check's transient-failure guard and its mid-flight failures still
		// surface through `text`.
		const text = engine.streamChat({
			providerId: prepared.model.providerId,
			modelId: prepared.model.id,
			credentials: prepared.credentials,
			systemPrompt: params.systemPrompt,
			messages: params.messages,
			maxOutputTokens: params.maxOutputTokens,
		}, token);

		return { available: true, model: { id: prepared.model.id, name: prepared.model.name }, usedFallback: prepared.usedFallback, text };
	}

	/**
	 * The availability pre-check: resolve the listing state, select a model, and
	 * freshly resolve its credentials. It can fail transiently (IPC/bridge
	 * startup); that surfaces as the distinct, retryable `temporarily-unavailable`
	 * reason rather than a throw -- the service's contract is that only the
	 * returned `text` iterable throws mid-stream.
	 */
	private async prepareRequest(selection: ModelSelection, token: CancellationToken): Promise<
		| { readonly ok: true; readonly model: IModelDescriptor; readonly credentials: ICredentials; readonly usedFallback: boolean }
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
			if (!state.anyCredential) {
				return { ok: false, reason: 'sign-in-required' };
			}

			const { model, usedFallback } = selectModel(state.models, this.resolveSelection(selection));
			if (!model) {
				return { ok: false, reason: 'no-model-matched' };
			}
			// A configured pattern set that matched nothing still lands the
			// top-priority model, but warn so a misconfigured pattern is
			// diagnosable rather than silently ignored. Keyed on the original
			// selection: a tier's default patterns missing is not a misconfiguration.
			if (usedFallback && hasKey(selection, { patterns: true }) && selection.patterns.length > 0) {
				this._logService.warn(`[headless-lm] Configured model patterns not found: ${JSON.stringify(selection.patterns)}`);
			}

			// Resolve credentials freshly for the chosen provider so short-lived
			// tokens stay valid. The token may have lapsed since listing.
			const credentials = await raceCancellation(this.resolveCredentialFor(model.providerId), token);
			if (token.isCancellationRequested) {
				return { ok: false, reason: 'temporarily-unavailable' };
			}
			if (!credentials) {
				return { ok: false, reason: 'sign-in-required' };
			}
			return { ok: true, model, credentials, usedFallback };
		} catch (error) {
			this._logService.warn(`[headless-lm] Availability check failed: ${error}`);
			return { ok: false, reason: 'temporarily-unavailable' };
		}
	}

	async getAvailableModels(): Promise<readonly IAvailableModel[]> {
		// A transient failure yields an empty list (the list API has no reason
		// slot); the state cache self-heals so the next call can recover.
		let state: IResolvedState;
		try {
			state = await this._state.get();
		} catch (error) {
			this._logService.warn(`[headless-lm] Listing available models failed: ${error}`);
			return [];
		}
		return state.models.map(model => ({ id: model.id, name: model.name, vendor: model.vendor }));
	}

	private async computeState(): Promise<IResolvedState> {
		const engine = this.getEngine();
		if (!engine) {
			return { models: [], anyCredential: false };
		}

		const mappings = await this._mappings.get();

		// Only query providers whose auth backend is actually registered. Calling
		// getSessions for an unregistered provider would fire its activation event
		// and time out waiting for it to register (e.g. 'deepseek-api' when the
		// user has no DeepSeek auth) -- both slow and, uncaught, fatal to the whole
		// sweep. The user's real sign-ins are registered, so this loses nothing.
		const registered = new Set(this._authService.getProviderIds());
		const relevant = mappings.filter(mapping => registered.has(mapping.authProviderId));

		// Read-only credential lookup across every registered mapped provider.
		const credentialed = (await Promise.all(relevant.map(async mapping => {
			const credentials = await this.resolveCredential(mapping);
			return credentials ? { providerId: mapping.providerId, credentials } : undefined;
		}))).filter((entry): entry is { providerId: string; credentials: ICredentials } => !!entry);

		// List models for each credentialed provider, tolerating per-provider
		// listing failures so one bad provider does not blank the picker.
		const listed = await Promise.all(credentialed.map(async ({ providerId, credentials }) => {
			try {
				return await engine.listModels(providerId, credentials);
			} catch (error) {
				this._logService.warn(`[headless-lm] Listing models for ${providerId} failed: ${error}`);
				return [] as IModelDescriptor[];
			}
		}));

		return { models: distinct(byPriority(listed.flat()), model => model.id), anyCredential: credentialed.length > 0 };
	}

	/**
	 * Resolve a selection for the selector: a tier becomes its configured
	 * preference patterns (with the built-in default as fallback); an id or
	 * pattern selection passes through unchanged.
	 */
	private resolveSelection(selection: ModelSelection): ResolvedModelSelection {
		if (!hasKey(selection, { tier: true })) {
			return selection;
		}
		const configured = this._configService.getValue<string[]>(TIER_SETTING_KEYS[selection.tier]);
		return { patterns: configured && configured.length > 0 ? configured : FAST_CHEAP_DEFAULT_PATTERNS };
	}

	/** Resolve credentials for a provider id, looking up its mapping first. */
	private async resolveCredentialFor(providerId: string): Promise<ICredentials | undefined> {
		const mapping = (await this._mappings.get()).find(m => m.providerId === providerId);
		return mapping ? this.resolveCredential(mapping) : undefined;
	}

	/**
	 * Resolve a provider's credentials. The auth-host-bound half -- the read-only
	 * session lookup -- runs here against IAuthenticationService (the renderer's
	 * own auth source), because the bridge's `vscode.authentication`-bound resolver
	 * cannot load off the extension host. Strictly read-only: it never creates a
	 * session, so a background feature can never trigger a sign-in prompt. The
	 * pure shaping half (token + settings -> credentials) is the bridge's
	 * `shapeCredentials`, so it stays in lockstep with the assistant path.
	 */
	private async resolveCredential(mapping: IProviderMapping): Promise<ICredentials | undefined> {
		const accessToken = await this.readAccessToken(mapping);
		if (!accessToken) {
			return undefined;
		}
		const shaped = shapeCredentials(mapping, accessToken, this.credentialConfig());
		// The bridge also models local providers (Ollama, LM Studio); the headless
		// service never resolves one (no mapped provider is local-typed), so they
		// fall outside ICredentials and are dropped here.
		return shaped && shaped.type !== 'local' ? shaped : undefined;
	}

	/** Silent session lookup with scope fallback, matching the bridge's resolver. */
	private async readAccessToken(mapping: IProviderMapping): Promise<string | undefined> {
		let sessions = await this.tryGetSessions(mapping.authProviderId, [...mapping.scopes]);
		if (sessions.length === 0 && mapping.fallbackScopes) {
			for (const fallback of mapping.fallbackScopes) {
				sessions = await this.tryGetSessions(mapping.authProviderId, [...fallback]);
				if (sessions.length > 0) {
					break;
				}
			}
		}
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

	/**
	 * The settings-reading half supplied to the bridge's `shapeCredentials`. Reads
	 * the same `authentication.*` keys the assistant uses, off IConfigurationService.
	 * The renderer has no process env, so region/host come from settings only;
	 * `shapeCredentials` owns which key each value maps to (the `us-east-1` default
	 * included).
	 */
	private credentialConfig(): CredentialConfig {
		return {
			getBaseUrl: configKey =>
				this._configService.getValue<string>(`authentication.${configKey}.baseUrl`) || undefined,
			getCustomHeaders: configKey =>
				this._configService.getValue<Record<string, string>>(`authentication.${configKey}.customHeaders`),
			getAwsRegion: () =>
				this._configService.getValue<{ AWS_REGION?: string }>('authentication.aws.credentials')?.AWS_REGION,
			getSnowflake: () => {
				const cfg = this._configService.getValue<{ SNOWFLAKE_HOST?: string; SNOWFLAKE_ACCOUNT?: string }>('authentication.snowflake.credentials');
				return { host: cfg?.SNOWFLAKE_HOST, account: cfg?.SNOWFLAKE_ACCOUNT };
			},
		};
	}
}
