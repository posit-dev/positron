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
	/** List the models a provider offers for the given session token (HTTP egress). */
	listModels(providerId: string, sessionToken: string | undefined): Promise<IModelListing>;
	/** Stream a chat completion as raw text deltas (HTTP egress). */
	streamChat(request: IEngineChatRequest, token: CancellationToken): AsyncIterable<string>;
	/** Which copy of the provider module serves this engine. */
	getProviderModuleSource(): Promise<IProviderModuleSource>;
}

/**
 * How a logical provider maps onto Positron's workbench authentication, as the
 * provider module declares it. Plain serializable data so it can cross the IPC
 * channel. The facade reads a session for `authProviderId` with `scopes` and
 * sends the raw token; the provider module shapes it.
 */
export interface IProviderMapping {
	/** Logical provider id understood by the engine (e.g. `anthropic`, `positai`). */
	readonly providerId: string;
	/** The workbench authentication provider id that backs it; absent for a local provider, which reads no session. */
	readonly authProviderId?: string;
	/** Scopes for the read-only session lookup (empty for API-key providers). */
	readonly scopes: readonly string[];
	/** False when credentials come from the catalog alone (local endpoints, Foundry in Entra mode). */
	readonly requiresSession: boolean;
}

/** A single message in a request's history (shared by the public surface and the engine). */
export interface ILanguageModelMessage {
	readonly role: 'user' | 'assistant';
	readonly content: string;
}

/** A model as the engine reports it: enough to select, route, and display. */
export interface IModelDescriptor {
	readonly id: string;
	readonly name: string;
	readonly vendor: string;
	/**
	 * The provider that serves this model. A routing secret: kept off the
	 * feature-facing model listing so nothing can select a backend by provider.
	 * Only the AI diagnostic report sees it, via
	 * `getModelListingDiagnostics`.
	 */
	readonly providerId: string;
}

/**
 * A provider's model listing. `credentialed` is false when the provider is
 * unknown or no credential could be built from the session and catalog.
 */
export interface IModelListing {
	readonly credentialed: boolean;
	readonly models: readonly IModelDescriptor[];
}

/** A chat request for the provider module, carrying the raw session token. */
export interface IEngineChatRequest {
	readonly providerId: string;
	readonly modelId: string;
	readonly sessionToken?: string;
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

/** Which copy of the provider module serves the process. */
export type IProviderModuleSource =
	| { readonly kind: 'assistant'; readonly folder: string }
	| { readonly kind: 'compiled-in'; readonly reason: string };

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

	listModels(providerId: string, sessionToken: string | undefined): Promise<IModelListing> {
		return this.channel.call('listModels', [providerId, sessionToken]);
	}

	getProviderModuleSource(): Promise<IProviderModuleSource> {
		return this.channel.call('getProviderModuleSource');
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
