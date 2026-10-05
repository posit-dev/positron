/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DeferredPromise } from '../../../../../base/common/async.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { ObjectNode } from '../../../positronObjectExplorer/common/objectExplorerBackend.js';
import { RuntimeClientState, RuntimeClientType } from '../../common/languageRuntimeClientInstance.js';
import { ObjectExplorerClientInstance, ObjectExplorerClientStatus } from '../../common/languageRuntimeObjectExplorerClient.js';
import { JsonObjectExplorerBackend } from '../../../positronObjectExplorer/common/jsonObjectExplorerBackend.js';
import { ObjectExplorerCommBackend } from '../../../positronObjectExplorer/common/objectExplorerCommBackend.js';
import { TestRuntimeClientInstance } from './testRuntimeClientInstance.js';

describe('ObjectExplorerClientInstance', () => {
	const disposables = ensureNoLeakedDisposables();

	const createClient = () => {
		const backend = new JsonObjectExplorerBackend('json:test', 'test.json', { a: 1 });
		const client = disposables.add(new ObjectExplorerClientInstance(backend));
		const statuses: ObjectExplorerClientStatus[] = [];
		disposables.add(client.onDidStatusUpdate(status => statuses.push(status)));
		return { backend, client, statuses };
	};

	it('reports computing while a request is in flight', async () => {
		const { client, statuses } = createClient();

		await client.getChildren([], 0, 10);

		expect(statuses).toEqual(['computing', 'idle']);
		expect(client.status).toBe('idle');
	});

	it('caches the state', async () => {
		const { client } = createClient();

		await client.getState();

		expect(client.cachedState?.title).toBe('test.json');
	});

	it('stays disconnected when the backend closes during a request, and rejects later requests', async () => {
		const { backend, client } = createClient();
		const pending = new DeferredPromise<ObjectNode>();
		vi.spyOn(backend, 'getRoot').mockReturnValue(pending.p);
		const onDidClose = vi.fn();
		disposables.add(client.onDidClose(onDidClose));

		const request = client.getRoot();
		backend.close();
		pending.error(new Error('closed'));
		await expect(request).rejects.toThrow('closed');

		expect(onDidClose).toHaveBeenCalledTimes(1);
		expect(client.status).toBe('disconnected');
		await expect(client.getRoot()).rejects.toThrow();
	});

	it('holds the error status until the error is cleared', async () => {
		const { client } = createClient();

		client.setError('bad file');
		await client.getRoot();
		expect([client.status, client.errorMessage]).toEqual(['error', 'bad file']);

		client.setError(undefined);
		expect([client.status, client.errorMessage]).toEqual(['idle', undefined]);
	});
});

describe('ObjectExplorerCommBackend', () => {
	const disposables = ensureNoLeakedDisposables();

	const createBackend = () => {
		const runtimeClient = new TestRuntimeClientInstance('comm-id', RuntimeClientType.ObjectExplorer);
		const backend = disposables.add(new ObjectExplorerCommBackend(runtimeClient));
		return { runtimeClient, backend };
	};

	it('sends RPCs with named parameters and unwraps formatted values', async () => {
		const { runtimeClient, backend } = createBackend();
		const requests: unknown[] = [];
		runtimeClient.rpcHandler = async request => {
			requests.push(request);
			return { data: { result: { content: 'full value' } }, buffers: [] };
		};

		const text = await backend.formatValue(['a', 'b']);

		expect(text).toBe('full value');
		expect(requests).toMatchObject([{ method: 'format_value', params: { path: ['a', 'b'] } }]);
		expect(backend.identifier).toBe('comm-id');
	});

	it('forwards update events and closure', () => {
		const { runtimeClient, backend } = createBackend();
		const onDidUpdate = vi.fn();
		const onDidClose = vi.fn();
		disposables.add(backend.onDidUpdate(onDidUpdate));
		disposables.add(backend.onDidClose(onDidClose));

		runtimeClient.receiveData({ data: { jsonrpc: '2.0', method: 'update', params: {} }, buffers: [] });
		runtimeClient.setClientState(RuntimeClientState.Closed);

		expect(onDidUpdate).toHaveBeenCalledTimes(1);
		expect(onDidClose).toHaveBeenCalledTimes(1);
	});
});
