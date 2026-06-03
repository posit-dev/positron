/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { AsyncIterableSource, cancellableIterable, raceTimeout } from '../../../../base/common/async.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IAuthenticationService, type AuthenticationSession } from '../../../services/authentication/common/authentication.js';
import { localize } from '../../../../nls.js';
import { hasKey } from '../../../../base/common/types.js';
import {
	FAST_CHEAP_DEFAULT_PATTERNS,
	IAvailableModel,
	IPositronLMService,
	IStreamTextParams,
	IpcCredentials,
	IpcModelInfo,
	IpcStreamEvent,
	ModelSelection,
	StreamFailure,
	StreamResult,
	TIER_SETTING_KEYS,
} from './positronLMService.js';

// --- Auth provider mapping ---

export interface AuthProviderMapping {
	providerId: string;
	type: 'apikey' | 'oauth' | 'aws-credentials';
	scopes?: readonly string[];
	fallbackScopes?: readonly (readonly string[])[];
}

export const AUTH_PROVIDER_MAP: ReadonlyMap<string, AuthProviderMapping> = new Map([
	['anthropic-api', { providerId: 'anthropic', type: 'apikey' }],
	['openai-api', { providerId: 'openai', type: 'apikey' }],
	['posit-ai', { providerId: 'positai', type: 'oauth', scopes: ['positai'] }],
	['google', { providerId: 'gemini', type: 'apikey' }],
	['amazon-bedrock', { providerId: 'bedrock', type: 'aws-credentials' }],
	['github', {
		providerId: 'copilot',
		type: 'apikey',
		scopes: ['read:user'],
		fallbackScopes: [['read:user', 'user:email', 'repo', 'workflow'], ['user:email']],
	}],
	['openai-compatible', { providerId: 'openai-compatible', type: 'apikey' }],
	['deepseek-api', { providerId: 'deepseek', type: 'apikey' }],
]);

// Order: Posit gateway > direct vendor APIs > aggregators. First available match wins.
export const PROVIDER_PRIORITY: readonly string[] = [
	'positai',
	'anthropic',
	'openai',
	'gemini',
	'deepseek',
	'copilot',
	'bedrock',
	'openai-compatible',
];

const PROVIDER_DISPLAY_NAMES: ReadonlyMap<string, string> = new Map([
	['positai', localize('positron.lm.provider.positai', "Posit AI")],
	['anthropic', localize('positron.lm.provider.anthropic', "Anthropic")],
	['openai', localize('positron.lm.provider.openai', "OpenAI")],
	['gemini', localize('positron.lm.provider.gemini', "Google Gemini")],
	['deepseek', localize('positron.lm.provider.deepseek', "DeepSeek")],
	['copilot', localize('positron.lm.provider.copilot', "GitHub Copilot")],
	['bedrock', localize('positron.lm.provider.bedrock', "Amazon Bedrock")],
	['openai-compatible', localize('positron.lm.provider.openaiCompatible', "OpenAI Compatible")],
]);

// --- Model matching ---

export interface ModelMatch {
	model: IpcModelInfo;
	providerId: string;
}

export function matchModelFromCache(
	cache: ReadonlyMap<string, IpcModelInfo[]>,
	patterns: string[],
): ModelMatch | null {
	if (cache.size === 0) {
		return null;
	}

	const orderedProviders: Array<{ providerId: string; models: IpcModelInfo[] }> = [];
	for (const providerId of PROVIDER_PRIORITY) {
		const models = cache.get(providerId);
		if (models && models.length > 0) {
			orderedProviders.push({ providerId, models });
		}
	}

	if (orderedProviders.length === 0) {
		return null;
	}

	for (const rawPattern of patterns) {
		const pattern = rawPattern.trim().toLowerCase();
		if (!pattern) {
			continue;
		}
		for (const { providerId, models } of orderedProviders) {
			for (const model of models) {
				const id = model.id.toLowerCase();
				const name = (model.name || '').toLowerCase();
				if (id.includes(pattern) || name.includes(pattern)) {
					return { model, providerId };
				}
			}
		}
	}

	// Fallback: first model from highest-priority provider
	return { model: orderedProviders[0].models[0], providerId: orderedProviders[0].providerId };
}

// --- Abstract base class ---

interface CachedCredential {
	credentials: IpcCredentials;
	expiry: number;
}

export abstract class AbstractPositronLMService extends Disposable implements IPositronLMService {
	declare readonly _serviceBrand: undefined;

	private readonly _channel: IChannel | null;
	private readonly _credentialCache = new Map<string, CachedCredential>();
	private static readonly CREDENTIAL_TTL = 5_000;
	private readonly _modelCache = new Map<string, IpcModelInfo[]>();
	private _modelCacheReady!: Promise<void>;
	private readonly _pendingRefreshes = new Set<Promise<void>>();

	private readonly _onDidChangeAvailableModels = this._register(new Emitter<IAvailableModel[]>());
	readonly onDidChangeAvailableModels: Event<IAvailableModel[]> = this._onDidChangeAvailableModels.event;

	constructor(
		channel: IChannel | null,
		@ILogService protected readonly _logService: ILogService,
		@IAuthenticationService private readonly _authenticationService: IAuthenticationService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();
		this._channel = channel;

		if (!this._channel) {
			this._modelCacheReady = Promise.resolve();
			return;
		}

		this._modelCacheReady = this._warmModelCache();

		this._register(this._authenticationService.onDidChangeSessions(e => {
			this._credentialCache.delete(e.providerId);
			const refresh = this._refreshModelsForAuthProvider(e.providerId);
			this._pendingRefreshes.add(refresh);
			refresh.finally(() => this._pendingRefreshes.delete(refresh));
		}));
	}

	get availableModels(): IAvailableModel[] {
		const result: IAvailableModel[] = [];
		for (const providerId of PROVIDER_PRIORITY) {
			const models = this._modelCache.get(providerId);
			if (!models) {
				continue;
			}
			const providerName = PROVIDER_DISPLAY_NAMES.get(providerId) ?? providerId;
			for (const model of models) {
				result.push({
					id: model.id,
					name: model.name || model.id,
					providerId,
					providerName,
				});
			}
		}
		return result;
	}

	async streamText(params: IStreamTextParams): Promise<StreamResult> {
		if (!this._channel) {
			return { failure: 'no-providers' };
		}

		await this._modelCacheReady;
		if (this._pendingRefreshes.size > 0) {
			await Promise.allSettled(this._pendingRefreshes);
		}

		const selection = params.model ?? { tier: 'fast-cheap' as const };
		let resolved = this._resolveModelSelection(selection);

		// On cache miss, attempt a single on-demand re-warm before giving up
		if (typeof resolved === 'string' && resolved === 'no-match') {
			this._logService.info('[PositronLM] Cache miss, attempting on-demand model refresh...');
			await this._warmModelCache();
			resolved = this._resolveModelSelection(selection);
		}

		if (typeof resolved === 'string') {
			return { failure: resolved };
		}

		this._logService.trace(`[PositronLM] Selected model: ${resolved.model.name || resolved.model.id} (${resolved.providerId})`);

		// Re-resolve credentials fresh before streaming.
		// Short-lived tokens (OAuth, AWS STS) may have rotated since cache-warm time.
		const authEntry = this._findAuthEntryForProvider(resolved.providerId);
		if (!authEntry) {
			this._logService.warn(`[PositronLM] No auth mapping for provider ${resolved.providerId}`);
			return { failure: 'auth-required' };
		}

		const credentials = await this._resolveCredentials(authEntry.authProviderId, authEntry.mapping);
		if (!credentials) {
			this._logService.warn(`[PositronLM] Credentials expired for ${resolved.providerId}`);
			return { failure: 'auth-required' };
		}

		const ipcEvent = this._channel.listen<IpcStreamEvent>('streamText', {
			providerId: resolved.providerId,
			credentials,
			modelId: resolved.model.id,
			systemPrompt: params.systemPrompt,
			messages: params.messages,
		});

		const source = new AsyncIterableSource<string>();
		let cancelListener: { dispose(): void } | undefined;

		const cleanup = () => {
			sub.dispose();
			cancelListener?.dispose();
		};

		const sub = ipcEvent(event => {
			switch (event.type) {
				case 'error':
					this._logService.warn('[PositronLM] Stream error:', event.message);
					source.reject(new Error(event.message));
					cleanup();
					break;
				case 'end':
					source.resolve();
					cleanup();
					break;
				case 'data':
					source.emitOne(event.text);
					break;
			}
		});

		// Cancellation uses two coordinated mechanisms: the listener disposes the IPC
		// subscription so the shared process stops streaming (via onDidRemoveLastListener),
		// while cancellableIterable terminates the consumer's iteration -- without it the
		// consumer would hang, since `source` is never resolved after the subscription is
		// disposed.
		let stream: AsyncIterable<string> = source.asyncIterable;
		if (params.cancellationToken && params.cancellationToken !== CancellationToken.None) {
			const token = params.cancellationToken;
			cancelListener = token.onCancellationRequested(() => cleanup());
			stream = cancellableIterable(source.asyncIterable[Symbol.asyncIterator](), token);
		}

		return { stream, modelName: resolved.model.name || resolved.model.id };
	}

	private _resolveModelSelection(selection: ModelSelection): ModelMatch | StreamFailure {
		if (this._modelCache.size === 0) {
			const hasProviders = this._authenticationService.getProviderIds().length > 0;
			return hasProviders ? 'auth-required' : 'no-providers';
		}

		if (hasKey(selection, { tier: true })) {
			const settingKey = TIER_SETTING_KEYS[selection.tier];
			const patterns = this._configurationService.getValue<string[]>(settingKey)
				|| [...FAST_CHEAP_DEFAULT_PATTERNS];
			return matchModelFromCache(this._modelCache, patterns) ?? 'no-match';
		}

		if (hasKey(selection, { id: true })) {
			for (const [providerId, models] of this._modelCache) {
				const found = models.find(m => m.id === selection.id);
				if (found) {
					return { model: found, providerId };
				}
			}
			return 'no-match';
		}

		if (hasKey(selection, { patterns: true })) {
			return matchModelFromCache(this._modelCache, selection.patterns) ?? 'no-match';
		}

		return 'no-match';
	}

	private async _warmModelCache(): Promise<void> {
		if (!this._channel) {
			return;
		}

		const resolved = await this._resolveAllCredentials();
		if (resolved.length === 0) {
			this._logService.info('[PositronLM] No credentials available at activation; model cache empty');
			return;
		}

		this._logService.info(`[PositronLM] Warming model cache for ${resolved.length} provider(s)`);

		const fetches = resolved.map(async ({ providerId, credentials }) => {
			try {
				const models = await raceTimeout(
					this._channel!.call<IpcModelInfo[]>('getModels', { providerId, credentials }),
					10_000
				);
				if (!models) {
					this._logService.warn(`[PositronLM] Timed out fetching models for ${providerId}`);
					return;
				}
				this._modelCache.set(providerId, models);
				this._logService.trace(`[PositronLM] Cached ${models.length} models for ${providerId}`);
			} catch (err) {
				this._logService.warn(`[PositronLM] Failed to fetch models for ${providerId}:`, err);
			}
		});

		await Promise.allSettled(fetches);
		this._logService.info(`[PositronLM] Model cache warmed: ${this._modelCache.size} provider(s) ready`);
		this._onDidChangeAvailableModels.fire(this.availableModels);
	}

	private async _refreshModelsForAuthProvider(authProviderId: string): Promise<void> {
		const mapping = AUTH_PROVIDER_MAP.get(authProviderId);
		if (!mapping) {
			return;
		}

		await this._modelCacheReady;

		const credentials = await this._resolveCredentials(authProviderId, mapping);
		if (!credentials) {
			this._modelCache.delete(mapping.providerId);
			this._logService.info(`[PositronLM] Cleared model cache for ${mapping.providerId} (session removed)`);
			this._onDidChangeAvailableModels.fire(this.availableModels);
			return;
		}

		if (!this._channel) {
			return;
		}

		try {
			const models = await raceTimeout(
				this._channel.call<IpcModelInfo[]>('getModels', { providerId: mapping.providerId, credentials }),
				10_000
			);
			if (!models) {
				this._logService.warn(`[PositronLM] Timed out refreshing models for ${mapping.providerId}`);
				return;
			}
			this._modelCache.set(mapping.providerId, models);
			this._logService.info(`[PositronLM] Refreshed model cache for ${mapping.providerId}: ${models.length} model(s)`);
			this._onDidChangeAvailableModels.fire(this.availableModels);
		} catch (err) {
			this._logService.warn(`[PositronLM] Failed to refresh models for ${mapping.providerId}:`, err);
		}
	}

	private _findAuthEntryForProvider(providerId: string): { authProviderId: string; mapping: AuthProviderMapping } | undefined {
		for (const [authProviderId, mapping] of AUTH_PROVIDER_MAP) {
			if (mapping.providerId === providerId) {
				return { authProviderId, mapping };
			}
		}
		return undefined;
	}

	private async _resolveAllCredentials(): Promise<Array<{ providerId: string; credentials: IpcCredentials }>> {
		const entries = Array.from(AUTH_PROVIDER_MAP.entries());
		const results = await Promise.allSettled(
			entries.map(async ([authProviderId, mapping]) => {
				const credentials = await this._resolveCredentials(authProviderId, mapping);
				if (credentials) {
					return { providerId: mapping.providerId, credentials };
				}
				return undefined;
			})
		);

		const resolved: Array<{ providerId: string; credentials: IpcCredentials }> = [];
		for (const result of results) {
			if (result.status === 'fulfilled' && result.value) {
				resolved.push(result.value);
			}
		}
		return resolved;
	}

	private async _resolveCredentials(
		authProviderId: string,
		mapping: AuthProviderMapping
	): Promise<IpcCredentials | undefined> {
		const now = Date.now();
		const cached = this._credentialCache.get(authProviderId);
		if (cached && cached.expiry > now) {
			return cached.credentials;
		}

		try {
			const sessions = await this._getSessions(authProviderId, mapping);
			if (!sessions || sessions.length === 0) {
				return undefined;
			}

			const session = sessions[0];
			let credentials: IpcCredentials | undefined;

			switch (mapping.type) {
				case 'apikey': {
					const apiKeyCredentials: IpcCredentials = {
						type: 'apikey',
						apiKey: session.accessToken,
					};
					const baseUrl = this._getConfiguredBaseUrl(authProviderId);
					if (baseUrl) {
						apiKeyCredentials.baseUrl = baseUrl;
					}
					const customHeaders = this._getConfiguredCustomHeaders(authProviderId);
					if (customHeaders) {
						apiKeyCredentials.customHeaders = customHeaders;
					}
					credentials = apiKeyCredentials;
					break;
				}
				case 'oauth':
					credentials = { type: 'oauth', accessToken: session.accessToken };
					break;
				case 'aws-credentials': {
					const parsed = JSON.parse(session.accessToken);
					const awsConfig = this._configurationService.getValue<{ AWS_REGION?: string }>('authentication.aws.credentials');
					const region = awsConfig?.AWS_REGION || 'us-east-1';
					credentials = {
						type: 'aws-credentials',
						region,
						accessKeyId: parsed.accessKeyId,
						secretAccessKey: parsed.secretAccessKey,
						sessionToken: parsed.sessionToken,
					};
					break;
				}
			}

			if (credentials) {
				this._credentialCache.set(authProviderId, {
					credentials,
					expiry: now + AbstractPositronLMService.CREDENTIAL_TTL,
				});
			}
			return credentials;
		} catch (err) {
			this._logService.trace(`[PositronLM] Failed to get sessions for ${authProviderId}:`, err);
			return undefined;
		}
	}

	private async _getSessions(
		authProviderId: string,
		mapping: AuthProviderMapping,
	): Promise<ReadonlyArray<AuthenticationSession>> {
		const sessions = await this._authenticationService.getSessions(authProviderId, mapping.scopes);
		if (sessions.length > 0) {
			return sessions;
		}

		for (const fallbackScopes of mapping.fallbackScopes ?? []) {
			const fallbackSessions = await this._authenticationService.getSessions(authProviderId, fallbackScopes);
			if (fallbackSessions.length > 0) {
				return fallbackSessions;
			}
		}

		return sessions;
	}

	private _getAuthConfigKey(authProviderId: string): string {
		switch (authProviderId) {
			case 'anthropic-api':
				return 'anthropic';
			default:
				return authProviderId;
		}
	}

	private _getConfiguredBaseUrl(authProviderId: string): string | undefined {
		const configKey = this._getAuthConfigKey(authProviderId);
		return this._configurationService.getValue<string>(`authentication.${configKey}.baseUrl`) || undefined;
	}

	private _getConfiguredCustomHeaders(authProviderId: string): Record<string, string> | undefined {
		const configKey = this._getAuthConfigKey(authProviderId);
		const customHeaders = this._configurationService.getValue<Record<string, string>>(`authentication.${configKey}.customHeaders`);
		return customHeaders && Object.keys(customHeaders).length > 0 ? customHeaders : undefined;
	}
}
