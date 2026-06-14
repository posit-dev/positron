/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncIterableObject } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { IChannel } from '../../../base/parts/ipc/common/ipc.js';

/**
 * The internal egress port for the headless language model service. This is the
 * single seam that needs Node and the provider bridge; everything above it
 * (selection, availability, credentials, caching) is environment-agnostic
 * policy in the workbench facade.
 *
 * It lives in `platform` (not `workbench`) so the Node engine can run in the
 * shared process and the remote server -- both of which may import `platform`
 * but not `workbench`. It speaks service-owned types only; the provider bridge
 * is an implementation detail of the Node engine and never crosses this
 * boundary. In production the port is the IPC channel client below talking to a
 * Node engine; in tests it is faked directly.
 */
export interface IHeadlessLanguageModelEngine {
	/**
	 * The provider -> Positron-auth mappings the provider bridge knows about.
	 * The bridge is the single source of truth for this; the engine forwards it
	 * so the renderer-side facade never has to import the bridge (which the
	 * browser layer forbids) or hand-maintain its own copy.
	 */
	getProviderMappings(): Promise<IProviderMapping[]>;
	/** List the models a provider offers for the given credentials (HTTP egress). */
	listModels(providerId: string, credentials: ICredentials): Promise<IModelDescriptor[]>;
	/** Stream a chat completion as raw text deltas (HTTP egress). */
	streamChat(request: IEngineChatRequest, token: CancellationToken): AsyncIterable<string>;
}

/**
 * How a logical provider maps onto Positron's workbench authentication, as the
 * provider bridge declares it (its `PROVIDER_MAP`). Plain serializable data so
 * it can cross the IPC channel. The facade reads a session for `authProviderId`
 * with `scopes` (falling back through `fallbackScopes`) and shapes the token per
 * `credentialType`.
 */
export interface IProviderMapping {
	/** Logical provider id understood by the engine (e.g. `anthropic`, `positai`). */
	readonly providerId: string;
	/** The workbench authentication provider id that backs it. */
	readonly authProviderId: string;
	/** Scopes for the read-only session lookup (empty for API-key providers). */
	readonly scopes: readonly string[];
	/** Ordered alternative scope sets to try when the primary lookup finds none. */
	readonly fallbackScopes?: readonly (readonly string[])[];
	/** How to shape the session's token into credentials. */
	readonly credentialType: 'apikey' | 'oauth' | 'aws-credentials' | 'google-cloud';
	/** Config namespace for apikey `baseUrl`/`customHeaders` (mirrors the bridge's overrides). */
	readonly configKey: string;
}

/** A single message in a request's history (shared by the public surface and the engine). */
export interface ILanguageModelMessage {
	readonly role: 'user' | 'assistant';
	readonly content: string;
}

/**
 * Credentials resolved by the facade and handed straight to the engine, which
 * forwards them to the bridge. Mirrors the bridge's `ProviderCredentials` shape
 * (minus the `local` variant the headless service never resolves), so the
 * facade's bridge-produced credentials pass through without conversion. The
 * optional `aws`/`google-cloud` fields match the bridge: AWS may authenticate by
 * profile, and Vertex may fall back to ADC when no token is brokered.
 */
export type ICredentials =
	| { readonly type: 'apikey'; readonly apiKey: string; readonly baseUrl?: string; readonly customHeaders?: Record<string, string> }
	| { readonly type: 'oauth'; readonly accessToken: string }
	| { readonly type: 'aws-credentials'; readonly region: string; readonly accessKeyId?: string; readonly secretAccessKey?: string; readonly sessionToken?: string }
	| { readonly type: 'google-cloud'; readonly project: string; readonly location: string; readonly accessToken?: string };

/** A model as the engine reports it: enough to select, route, and display. */
export interface IModelDescriptor {
	readonly id: string;
	readonly name: string;
	readonly vendor: string;
	/** The provider that serves this model. A routing secret, never exposed to consumers. */
	readonly providerId: string;
}

/** A fully-resolved chat request, ready for the provider bridge. */
export interface IEngineChatRequest {
	readonly providerId: string;
	readonly modelId: string;
	readonly credentials: ICredentials;
	readonly systemPrompt: string;
	readonly messages: readonly ILanguageModelMessage[];
	readonly maxOutputTokens?: number;
}

/**
 * One streamed chunk crossing the IPC channel. The channel layer marshals
 * events, not async iterables, so the stream is expressed as a sequence of
 * these and reassembled into an `AsyncIterable<string>` on the consuming side.
 */
export type EngineStreamChunk =
	| { readonly type: 'delta'; readonly value: string }
	| { readonly type: 'done' }
	| { readonly type: 'error'; readonly message: string };

/** The IPC channel name under which the engine is registered. */
export const HEADLESS_LM_ENGINE_CHANNEL = 'positronHeadlessLanguageModelEngine';

/**
 * Implements the engine port over an IPC {@link IChannel}, hiding the
 * event-based streaming/cancellation plumbing behind a clean async iterable.
 */
export class HeadlessLanguageModelEngineChannelClient implements IHeadlessLanguageModelEngine {

	constructor(private readonly channel: IChannel) { }

	getProviderMappings(): Promise<IProviderMapping[]> {
		return this.channel.call('getProviderMappings');
	}

	listModels(providerId: string, credentials: ICredentials): Promise<IModelDescriptor[]> {
		return this.channel.call('listModels', [providerId, credentials]);
	}

	streamChat(request: IEngineChatRequest, token: CancellationToken): AsyncIterable<string> {
		const store = new DisposableStore();
		return new AsyncIterableObject<string>(
			(emitter) => new Promise<void>((resolve) => {
				if (token.isCancellationRequested) {
					resolve();
					return;
				}
				// Resolving ends the iterable normally; rejecting throws to the
				// consumer. Either way we tear down the channel subscription,
				// which the protocol propagates to the server to cancel egress.
				const finish = () => { store.dispose(); resolve(); };
				const stream = this.channel.listen<EngineStreamChunk>('chatStream', request);
				store.add(stream((chunk) => {
					switch (chunk.type) {
						case 'delta': emitter.emitOne(chunk.value); break;
						case 'done': finish(); break;
						case 'error': emitter.reject(new Error(chunk.message)); finish(); break;
					}
				}));
				store.add(token.onCancellationRequested(() => finish()));
			}),
			// Called when the consumer abandons the iterable early (e.g. cancel).
			() => store.dispose()
		);
	}
}
