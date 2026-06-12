/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Logger, ModelInfo, ModelMessage, ProviderId, ProviderRegistry } from 'ai-provider-bridge';
import { AsyncIterableObject } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { SelfHealingLazyPromise } from '../../../base/common/positron/async.js';
import { ILogService } from '../../log/common/log.js';
import { ICredentials, IEngineChatRequest, IHeadlessLanguageModelEngine, IModelDescriptor, IProviderMapping } from '../common/engine.js';

/**
 * The Node-side egress engine: the one place that touches the provider bridge
 * and the network. It is intentionally thin -- it holds no policy. Selection,
 * priority, credentials, and availability all live in the workbench facade;
 * this just lists models and streams text for an already-chosen provider/model,
 * and adapts the service-owned port types to the bridge.
 *
 * Runs in the shared process (desktop) or the remote server (Remote SSH / web)
 * and is reached over an IPC channel.
 */
export class HeadlessLanguageModelEngine implements IHeadlessLanguageModelEngine {

	private readonly _logger: Logger;
	/** Self-healing so a transient first-use failure (e.g. a deferred bridge import error) retries on the next call. */
	private readonly _registry = new SelfHealingLazyPromise(() => this.createRegistry());

	constructor(logService: ILogService) {
		this._logger = {
			info: (m: string, ...a: unknown[]) => logService.info(m, ...a),
			warn: (m: string, ...a: unknown[]) => logService.warn(m, ...a),
			error: (m: string, ...a: unknown[]) => logService.error(m, ...a),
			debug: (m: string, ...a: unknown[]) => logService.debug(m, ...a),
			trace: (m: string, ...a: unknown[]) => logService.trace(m, ...a),
		};
	}

	async getProviderMappings(): Promise<IProviderMapping[]> {
		// The bridge owns the provider -> auth mapping; forward it as plain data
		// so the renderer never has to import the bridge or duplicate the map.
		// Dynamic import (not static): the bridge is a node module the lint forbids
		// loading synchronously at startup; CONFIG_KEY_OVERRIDES comes from its pure
		// credential-shaping entry, the single source the renderer also consumes.
		const { PROVIDER_MAP, MAPPED_PROVIDER_IDS } = await import('ai-provider-bridge');
		const { CONFIG_KEY_OVERRIDES } = await import('ai-provider-bridge/credential-shaping');
		return MAPPED_PROVIDER_IDS.flatMap((providerId: ProviderId) => {
			const mapping = PROVIDER_MAP[providerId];
			if (!mapping) {
				return [];
			}
			return [{
				providerId,
				authProviderId: mapping.authProviderId,
				scopes: mapping.scopes,
				fallbackScopes: mapping.fallbackScopes,
				credentialType: mapping.credentialType,
				configKey: CONFIG_KEY_OVERRIDES[mapping.authProviderId] ?? mapping.authProviderId,
			}];
		});
	}

	async listModels(providerId: string, credentials: ICredentials): Promise<IModelDescriptor[]> {
		const registry = await this._registry.get();
		const models = await registry.getModelsForProvider(providerId, credentials);
		return models.map((model: ModelInfo) => ({ id: model.id, name: model.name, vendor: model.vendor, providerId }));
	}

	streamChat(request: IEngineChatRequest, token: CancellationToken): AsyncIterable<string> {
		return new AsyncIterableObject<string>(async (emitter) => {
			const registry = await this._registry.get();
			const client = registry.getClientForProvider(request.providerId, request.credentials);
			if (!client) {
				throw new Error(`No client for provider ${request.providerId}`);
			}

			const messages: ModelMessage[] = request.messages.map(message =>
				message.role === 'user'
					? { role: 'user', content: message.content }
					: { role: 'assistant', content: message.content });

			const stream = await client.chat({
				model: request.modelId,
				messages,
				systemPrompt: request.systemPrompt,
				maxOutputTokens: request.maxOutputTokens,
				cancellationToken: token,
			});

			for await (const part of stream) {
				if (token.isCancellationRequested) {
					break;
				}
				if (part.type === 'text-delta') {
					emitter.emitOne(part.text);
				}
			}
		});
	}

	private async createRegistry(): Promise<ProviderRegistry> {
		// Deferred so the bridge and its heavy AI-SDK dependencies load only on
		// first use rather than synchronously at startup.
		const { ProviderRegistry, POSIT_AI_DEFAULTS, MAPPED_PROVIDER_IDS } = await import('ai-provider-bridge');
		const { registerAllProviders } = await import('ai-provider-bridge/providers');
		const registry = new ProviderRegistry(this._logger);
		// Register exactly the providers the bridge has an auth mapping for
		// (MAPPED_PROVIDER_IDS) -- the same set getProviderMappings() exposes to
		// the renderer -- so the registered providers and the renderer-facing
		// mappings cannot drift. Providers without an auth mapping (e.g. the local
		// Ollama / LM Studio endpoints) need an endpoint-based credential path the
		// headless service does not implement, so the bridge's `allowedProviders`
		// filter excludes them. The Posit AI gateway is the first-party path the
		// priority policy prefers.
		registerAllProviders(registry, this._logger, {
			positAiBaseUrl: POSIT_AI_DEFAULTS.baseUrl,
			userAgent: 'Positron/headless',
			allowedProviders: [...MAPPED_PROVIDER_IDS],
		});
		return registry;
	}
}
