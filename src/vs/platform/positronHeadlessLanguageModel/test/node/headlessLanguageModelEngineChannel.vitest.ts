/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { EngineStreamChunk, ICredentials, IEngineChatRequest, IHeadlessLanguageModelEngine, IModelDescriptor, IProviderMapping } from '../../common/engine.js';
import { HeadlessLanguageModelEngineChannel } from '../../node/headlessLanguageModelEngineChannel.js';

const request: IEngineChatRequest = {
	providerId: 'positai',
	modelId: 'm',
	credentials: { type: 'oauth', accessToken: 't' },
	systemPrompt: 's',
	messages: [],
};

const mappings: IProviderMapping[] = [
	{ providerId: 'positai', authProviderId: 'posit', scopes: [], credentialType: 'oauth', configKey: 'positron.assistant.positai' },
];

const models: IModelDescriptor[] = [{ id: 'm', name: 'M', vendor: 'V', providerId: 'positai' }];

const noStream = (): AsyncIterable<string> => (async function* () { })();

function fakeEngine(overrides: Partial<IHeadlessLanguageModelEngine> = {}): IHeadlessLanguageModelEngine {
	return {
		getProviderMappings: async () => mappings,
		listModels: async () => models,
		streamChat: () => noStream(),
		...overrides,
	};
}

/** Subscribe to the chat stream and collect chunks until a terminal one arrives. */
async function collectStream(channel: HeadlessLanguageModelEngineChannel): Promise<EngineStreamChunk[]> {
	const store = new DisposableStore();
	const chunks: EngineStreamChunk[] = [];
	try {
		await new Promise<void>(resolve => {
			store.add(channel.listen<EngineStreamChunk>(null, 'chatStream', request)(chunk => {
				chunks.push(chunk);
				if (chunk.type === 'done' || chunk.type === 'error') {
					resolve();
				}
			}));
		});
	} finally {
		store.dispose();
	}
	return chunks;
}

describe('HeadlessLanguageModelEngineChannel', () => {
	it('routes getProviderMappings to the engine', async () => {
		const channel = new HeadlessLanguageModelEngineChannel(fakeEngine());
		expect(await channel.call<IProviderMapping[]>(null, 'getProviderMappings')).toEqual(mappings);
	});

	it('routes listModels with its provider id and credentials', async () => {
		let seen: [string, ICredentials] | undefined;
		const channel = new HeadlessLanguageModelEngineChannel(fakeEngine({
			listModels: async (providerId, credentials) => { seen = [providerId, credentials]; return models; },
		}));
		const result = await channel.call<IModelDescriptor[]>(null, 'listModels', ['positai', { type: 'oauth', accessToken: 't' }]);
		expect({ result, seen }).toEqual({ result: models, seen: ['positai', { type: 'oauth', accessToken: 't' }] });
	});

	it('throws on an unknown call or listen', () => {
		const channel = new HeadlessLanguageModelEngineChannel(fakeEngine());
		expect(() => channel.call(null, 'nope')).toThrow('Unknown channel call');
		expect(() => channel.listen(null, 'nope')).toThrow('Unknown channel event');
	});

	it('marshals engine deltas into chunk events ending in done', async () => {
		const channel = new HeadlessLanguageModelEngineChannel(fakeEngine({
			streamChat: () => (async function* () { yield 'Hello, '; yield 'world'; })(),
		}));
		expect(await collectStream(channel)).toEqual([
			{ type: 'delta', value: 'Hello, ' },
			{ type: 'delta', value: 'world' },
			{ type: 'done' },
		]);
	});

	it('marshals a thrown engine error into an error chunk', async () => {
		const channel = new HeadlessLanguageModelEngineChannel(fakeEngine({
			streamChat: () => (async function* (): AsyncGenerator<string> { throw new Error('provider unreachable'); })(),
		}));
		expect(await collectStream(channel)).toEqual([{ type: 'error', message: 'provider unreachable' }]);
	});

	it('cancels the engine stream when the subscription is dropped', async () => {
		let resolveCancelled!: () => void;
		const cancelled = new Promise<void>(resolve => { resolveCancelled = resolve; });
		const channel = new HeadlessLanguageModelEngineChannel(fakeEngine({
			streamChat: (_req, token) => (async function* () {
				yield 'a';
				await new Promise<void>(resolve => token.onCancellationRequested(() => { resolveCancelled(); resolve(); }));
			})(),
		}));
		const store = new DisposableStore();
		await new Promise<void>(resolve => {
			store.add(channel.listen<EngineStreamChunk>(null, 'chatStream', request)(chunk => {
				if (chunk.type === 'delta') {
					resolve();
				}
			}));
		});
		// Dropping the last listener must cancel the upstream request.
		store.dispose();
		await cancelled;
	});
});
