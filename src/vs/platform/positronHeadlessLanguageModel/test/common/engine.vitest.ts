/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { EngineStreamChunk, HeadlessLanguageModelEngineChannelClient, IEngineChatRequest } from '../../common/engine.js';

const request: IEngineChatRequest = {
	providerId: 'positai',
	modelId: 'm',
	credentials: { type: 'oauth', accessToken: 't' },
	systemPrompt: 's',
	messages: [],
};

/**
 * A fake channel that exposes the chat-stream emitter so a test can fire chunks,
 * and tracks when the client disposes its subscription (cancellation/teardown).
 */
class FakeChannel implements IChannel {
	private readonly _chunks = new Emitter<EngineStreamChunk>({
		onDidAddFirstListener: () => this._resolveSubscribed(),
		onDidRemoveLastListener: () => { this.disposed = true; },
	});
	disposed = false;
	private _resolveSubscribed!: () => void;
	readonly subscribed = new Promise<void>(resolve => { this._resolveSubscribed = resolve; });

	call<T>(): Promise<T> {
		return Promise.resolve([{ id: 'm', name: 'M', vendor: 'V', providerId: 'positai' }] as T);
	}

	listen<T>(): Event<T> {
		return this._chunks.event as Event<unknown> as Event<T>;
	}

	fire(chunk: EngineStreamChunk): void {
		this._chunks.fire(chunk);
	}
}

describe('HeadlessLanguageModelEngineChannelClient', () => {
	it('reassembles delta chunks into a text stream and ends on done', async () => {
		const channel = new FakeChannel();
		const client = new HeadlessLanguageModelEngineChannelClient(channel);
		const collected: string[] = [];

		const consume = (async () => {
			for await (const chunk of client.streamChat(request, new CancellationTokenSource().token)) {
				collected.push(chunk);
			}
		})();

		await channel.subscribed;
		channel.fire({ type: 'delta', value: 'Hello, ' });
		channel.fire({ type: 'delta', value: 'world' });
		channel.fire({ type: 'done' });
		await consume;

		expect(collected.join('')).toBe('Hello, world');
		expect(channel.disposed).toBe(true);
	});

	it('throws to the consumer on an error chunk', async () => {
		const channel = new FakeChannel();
		const client = new HeadlessLanguageModelEngineChannelClient(channel);

		const consume = (async () => {
			for await (const _ of client.streamChat(request, new CancellationTokenSource().token)) {
				// drain
			}
		})();

		await channel.subscribed;
		channel.fire({ type: 'delta', value: 'partial' });
		channel.fire({ type: 'error', message: 'provider unreachable' });

		await expect(consume).rejects.toThrow('provider unreachable');
	});

	it('cancellation ends the stream and tears down the channel subscription', async () => {
		const channel = new FakeChannel();
		const client = new HeadlessLanguageModelEngineChannelClient(channel);
		const cts = new CancellationTokenSource();

		const consume = (async () => {
			for await (const _ of client.streamChat(request, cts.token)) {
				// drain
			}
		})();

		await channel.subscribed;
		channel.fire({ type: 'delta', value: 'a' });
		cts.cancel();
		await consume;

		expect(channel.disposed).toBe(true);
	});

	it('lists models via the request/response call', async () => {
		const client = new HeadlessLanguageModelEngineChannelClient(new FakeChannel());
		const models = await client.listModels('positai', { type: 'oauth', accessToken: 't' });
		expect(models).toEqual([{ id: 'm', name: 'M', vendor: 'V', providerId: 'positai' }]);
	});
});
