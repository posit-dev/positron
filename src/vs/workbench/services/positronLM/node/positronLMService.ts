/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { raceTimeout } from '../../../../base/common/async.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import {
	type IpcCredentials,
	type IpcGetModelsArgs,
	type IpcModelInfo,
	type IpcStreamEvent,
	type IpcStreamTextArgs,
} from '../common/positronLMService.js';

/** Interval (ms) for batching text chunks sent over IPC. */
const BATCH_INTERVAL_MS = 16;

// Credentials are passed directly to the provider-bridge. If we later need to
// strip internal fields or remap shapes before crossing the IPC boundary,
// extract a toProviderCredentials() sanitizer here.

/**
 * Long-lived LM service running in the shared process.
 * Owns a ProviderRegistry with all providers registered lazily on first use.
 */
export class PositronLMNode {

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider-bridge ships without .d.ts
	private _registry: any | null = null;
	private _initPromise: Promise<void> | null = null;

	constructor(
		@ILogService private readonly logService: ILogService,
	) { }

	private _ensureInitialized(): Promise<void> {
		if (!this._initPromise) {
			this._initPromise = this._doInit();
		}
		return this._initPromise;
	}

	private async _doInit(): Promise<void> {
		try {
			this.logService.info('[PositronLM-node] Loading provider-bridge...');
			const bridge = await import('ai-provider-bridge');
			const providers = await import('ai-provider-bridge/providers');

			const logger = {
				info: (msg: string, ...args: unknown[]) => { this.logService.info(msg, ...args); },
				warn: (msg: string, ...args: unknown[]) => { this.logService.warn(msg, ...args); },
				error: (msg: string, ...args: unknown[]) => { this.logService.error(msg, ...args); },
				debug: (msg: string, ...args: unknown[]) => { this.logService.debug(msg, ...args); },
				trace: (msg: string, ...args: unknown[]) => { this.logService.trace(msg, ...args); },
			};

			this._registry = new bridge.ProviderRegistry(logger);

			providers.registerAnthropicProvider(this._registry, logger);
			providers.registerBedrockProvider(this._registry, logger);
			providers.registerCopilotProvider(this._registry, logger);
			providers.registerDeepSeekProvider(this._registry, logger);
			providers.registerFoundryProvider(this._registry, logger);
			providers.registerGeminiProvider(this._registry, logger);
			providers.registerGoogleVertexProvider(this._registry, logger);
			providers.registerLMStudioProvider(this._registry, logger);
			providers.registerOllamaProvider(this._registry, logger);
			providers.registerOpenAICompatibleProvider(this._registry, logger);
			providers.registerOpenAIProvider(this._registry, logger);
			providers.registerOpenRouterProvider(this._registry, logger);
			providers.registerPositAiProvider(this._registry, bridge.POSIT_AI_DEFAULTS.baseUrl, 'Positron/headless', logger);
			providers.registerSnowflakeCortexProvider(this._registry, logger);

			this.logService.info('[PositronLM-node] Provider-bridge loaded, all providers registered');
		} catch (err) {
			this.logService.error('[PositronLM-node] Failed to load provider-bridge:', err);
			this._registry = null;
		}
	}

	/**
	 * Fetch available models for a provider. The underlying fetcher uses a
	 * 60-minute cache so repeated calls are cheap.
	 */
	async getModelsForProvider(providerId: string, credentials: IpcCredentials): Promise<IpcModelInfo[]> {
		this.logService.trace(`[PositronLM-node] getModelsForProvider called for ${providerId}, creds type: ${credentials?.type}`);
		await this._ensureInitialized();
		if (!this._registry) {
			this.logService.warn(`[PositronLM-node] Registry is null, returning empty`);
			return [];
		}
		try {
			this.logService.trace(`[PositronLM-node] Calling registry.getModelsForProvider for ${providerId}...`);
			const models = await raceTimeout<{ id: string; name?: string; providerId: string }[]>(
				this._registry.getModelsForProvider(providerId, credentials),
				15_000
			);
			if (!models) {
				this.logService.warn(`[PositronLM-node] Model fetch timed out for ${providerId}`);
				return [];
			}
			this.logService.trace(`[PositronLM-node] Got ${models.length} models for ${providerId}`);
			return models.map((m: { id: string; name?: string; providerId: string }) => ({
				id: m.id,
				name: m.name,
				providerId: m.providerId,
			}));
		} catch (err) {
			this.logService.warn(`[PositronLM-node] getModelsForProvider failed for ${providerId}:`, err);
			return [];
		}
	}

	/**
	 * Stream text from a model. Returns an Event that emits IpcStreamEvent values.
	 * Follows the onDidRemoveLastListener pattern from diskFileSystemProviderServer.ts:
	 * cancellation and cleanup happen when the last listener detaches.
	 */
	streamText(args: IpcStreamTextArgs): Event<IpcStreamEvent> {
		const cts = new CancellationTokenSource();

		const emitter = new Emitter<IpcStreamEvent>({
			onDidRemoveLastListener: () => {
				cts.cancel();
				emitter.dispose();
			}
		});

		// Start streaming in the background (don't await)
		this.doStreamText(args, cts, emitter);

		return emitter.event;
	}

	private async doStreamText(
		args: IpcStreamTextArgs,
		cts: CancellationTokenSource,
		emitter: Emitter<IpcStreamEvent>,
	): Promise<void> {
		let batchBuffer = '';
		let batchTimer: ReturnType<typeof setTimeout> | undefined;

		const flushBuffer = () => {
			if (batchTimer !== undefined) {
				clearTimeout(batchTimer);
				batchTimer = undefined;
			}
			if (batchBuffer.length > 0) {
				emitter.fire({ type: 'data', text: batchBuffer });
				batchBuffer = '';
			}
		};

		const cleanup = () => {
			if (batchTimer !== undefined) {
				clearTimeout(batchTimer);
				batchTimer = undefined;
			}
			cts.dispose();
			emitter.dispose();
		};

		try {
			await this._ensureInitialized();
			if (!this._registry) {
				emitter.fire({ type: 'error', message: 'Provider-bridge failed to load' });
				emitter.fire({ type: 'end' });
				cleanup();
				return;
			}

			const client = this._registry.getClientForProvider(args.providerId, args.credentials);

			if (!client) {
				emitter.fire({ type: 'error', message: `Unknown provider or invalid credentials: ${args.providerId}` });
				emitter.fire({ type: 'end' });
				cleanup();
				return;
			}

			// Build messages in the format expected by ModelClient.chat()
			const messages = args.messages.map(m => ({
				role: m.role as 'user' | 'assistant',
				content: m.content,
			}));

			const stream = await client.chat({
				model: args.modelId,
				messages,
				systemPrompt: args.systemPrompt,
				cancellationToken: {
					get isCancellationRequested() { return cts.token.isCancellationRequested; },
					onCancellationRequested: (listener: (e: unknown) => void) => {
						const disposable = cts.token.onCancellationRequested(() => listener(undefined));
						return { dispose: () => disposable.dispose() };
					},
				},
			});

			for await (const part of stream) {
				// Check cancellation before processing
				if (cts.token.isCancellationRequested) {
					break;
				}

				if (part.type === 'text-delta') {
					batchBuffer += part.text;

					// Schedule flush if not already scheduled
					if (batchTimer === undefined) {
						batchTimer = setTimeout(() => {
							batchTimer = undefined;
							if (batchBuffer.length > 0) {
								emitter.fire({ type: 'data', text: batchBuffer });
								batchBuffer = '';
							}
						}, BATCH_INTERVAL_MS);
					}
				}
			}

			// Flush any remaining text in the buffer
			flushBuffer();
			emitter.fire({ type: 'end' });
			cleanup();
		} catch (err) {
			flushBuffer();
			const message = err instanceof Error ? err.message : String(err);
			emitter.fire({ type: 'error', message });
			emitter.fire({ type: 'end' });
			cleanup();
		}
	}
}

/**
 * IPC channel exposing PositronLMNode to renderer processes.
 */
export class PositronLMChannel<TContext = string> implements IServerChannel<TContext> {

	constructor(
		private readonly service: PositronLMNode,
	) { }

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- IServerChannel interface signature
	call<T>(_ctx: TContext, command: string, arg?: any): Promise<T> {
		switch (command) {
			case 'getModels': {
				const typedArg = arg as IpcGetModelsArgs;
				return this.service.getModelsForProvider(typedArg.providerId, typedArg.credentials) as Promise<T>;
			}
		}

		throw new Error(`IPC command not found: ${command}`);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- IServerChannel interface signature
	listen<T>(_ctx: TContext, event: string, arg?: any): Event<T> {
		switch (event) {
			case 'streamText': {
				const typedArg = arg as IpcStreamTextArgs;
				return this.service.streamText(typedArg) as Event<T>;
			}
		}

		throw new Error(`Unknown event: ${event}`);
	}

	dispose(): void {
		// No-op: the service is long-lived and shared across all clients
	}
}
