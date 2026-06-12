/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { EngineStreamChunk, ICredentials, IEngineChatRequest, IHeadlessLanguageModelEngine } from '../common/engine.js';

/**
 * Exposes a {@link IHeadlessLanguageModelEngine} over an IPC channel. Listing is
 * a request/response `call`; streaming is an event `listen` whose returned event
 * fires one {@link EngineStreamChunk} per delta, then a terminal `done`/`error`.
 *
 * When the consumer disposes its subscription (on completion or cancellation),
 * the channel protocol drops the last listener here, which cancels the upstream
 * request -- so cancellation propagates back across the boundary for free.
 */
export class HeadlessLanguageModelEngineChannel implements IServerChannel {

	constructor(private readonly engine: IHeadlessLanguageModelEngine) { }

	call<T>(_ctx: unknown, command: string, arg?: unknown): Promise<T> {
		switch (command) {
			case 'getProviderMappings':
				return this.engine.getProviderMappings() as Promise<T>;
			case 'listModels': {
				const [providerId, credentials] = arg as [string, ICredentials];
				return this.engine.listModels(providerId, credentials) as Promise<T>;
			}
		}
		throw new Error(`[headless-lm] Unknown channel call: ${command}`);
	}

	listen<T>(_ctx: unknown, event: string, arg?: unknown): Event<T> {
		switch (event) {
			case 'chatStream':
				return this.chatStream(arg as IEngineChatRequest) as Event<unknown> as Event<T>;
		}
		throw new Error(`[headless-lm] Unknown channel event: ${event}`);
	}

	private chatStream(request: IEngineChatRequest): Event<EngineStreamChunk> {
		const cts = new CancellationTokenSource();
		const emitter = new Emitter<EngineStreamChunk>({
			// Last subscriber gone => caller cancelled or finished; stop egress.
			onDidRemoveLastListener: () => cts.dispose(true),
		});

		(async () => {
			try {
				for await (const delta of this.engine.streamChat(request, cts.token)) {
					if (cts.token.isCancellationRequested) {
						return;
					}
					emitter.fire({ type: 'delta', value: delta });
				}
				if (!cts.token.isCancellationRequested) {
					emitter.fire({ type: 'done' });
				}
			} catch (error) {
				if (!cts.token.isCancellationRequested) {
					emitter.fire({ type: 'error', message: error instanceof Error ? error.message : String(error) });
				}
			}
		})();

		return emitter.event;
	}
}
