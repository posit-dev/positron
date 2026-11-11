/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Mock } from 'vitest';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ConnectionsClientInstance } from '../../languageRuntime/common/languageRuntimeConnectionsClient.js';
import { RuntimeClientState, RuntimeClientType } from '../../languageRuntime/common/languageRuntimeClientInstance.js';
import { ObjectSchema } from '../../languageRuntime/common/positronConnectionsComm.js';
import { TestRuntimeClientInstance } from '../../languageRuntime/test/common/testRuntimeClientInstance.js';
import { RuntimeConnectionHandle } from '../browser/runtimeConnectionHandle.js';

interface RpcRequest {
	method: string;
	params: { path: ObjectSchema[] };
}

describe('Positron - Runtime Connection Handle', () => {
	let disposables: DisposableStore;
	let testClient: TestRuntimeClientInstance;
	let client: ConnectionsClientInstance;
	let requests: RpcRequest[];
	let objects: Record<string, ObjectSchema[]>;
	let dataPaths: Set<string>;
	let onDidDisconnect: Mock<() => void>;
	let handle: RuntimeConnectionHandle;

	const pathKey = (path: ObjectSchema[]) => path.map(item => item.name).join('/');

	beforeEach(() => {
		disposables = new DisposableStore();
		requests = [];
		objects = {};
		dataPaths = new Set();
		testClient = disposables.add(new TestRuntimeClientInstance('connection-1', RuntimeClientType.Connection));
		testClient.setClientState(RuntimeClientState.Connected);
		testClient.rpcHandler = async (request: RpcRequest) => {
			requests.push(request);
			const key = pathKey(request.params.path);
			switch (request.method) {
				case 'list_objects':
					return { data: { result: objects[key] ?? [] } };
				case 'list_fields':
					return { data: { result: [{ name: 'mpg', dtype: 'double' }] } };
				case 'contains_data':
					return { data: { result: dataPaths.has(key) } };
				case 'preview_object':
					return { data: { result: null } };
				default:
					throw new Error(`Unknown method: ${request.method}`);
			}
		};
		client = new ConnectionsClientInstance(testClient);
		onDidDisconnect = vi.fn<() => void>();
		handle = disposables.add(new RuntimeConnectionHandle(-1, client, onDidDisconnect, 'SQLiteConnection'));
	});

	afterEach(() => {
		vi.restoreAllMocks();
		disposables.dispose();
	});

	it('lists top-level objects with preview and children flags', async () => {
		objects[''] = [{ name: 'main', kind: 'schema' }];

		expect(await handle.getChildren()).toEqual([{
			nodeHandle: expect.any(Number),
			name: 'main',
			kind: 'schema',
			hasGetChildren: true,
			hasPreview: false,
			hasDetails: false,
		}]);
	});

	it('lists fields under a table', async () => {
		objects[''] = [{ name: 'main', kind: 'schema' }];
		objects.main = [{ name: 'mtcars', kind: 'table' }];
		dataPaths.add('main/mtcars');

		const [schema] = await handle.getChildren();
		const [table] = await handle.nodeGetChildren(schema.nodeHandle);
		expect(table.hasPreview).toBe(true);
		expect(table.defaultAction).toBe('preview');

		const fields = await handle.nodeGetChildren(table.nodeHandle);
		expect(fields).toEqual([{
			nodeHandle: expect.any(Number),
			name: 'mpg',
			kind: 'field',
			dataType: 'double',
			hasGetChildren: false,
			hasPreview: false,
			hasDetails: false,
		}]);
		expect(requests.find(request => request.method === 'list_fields')?.params.path).toEqual([
			{ name: 'main', kind: 'schema' },
			{ name: 'mtcars', kind: 'table' },
		]);
	});

	it('does not ask whether a field contains data', async () => {
		objects[''] = [{ name: 'mtcars', kind: 'table' }];
		dataPaths.add('mtcars');

		const [table] = await handle.getChildren();
		requests = [];
		await handle.nodeGetChildren(table.nodeHandle);

		expect(requests.map(request => request.method)).toEqual(['contains_data', 'list_fields']);
	});

	it('keeps a retained walk usable across a plain refresh', async () => {
		objects[''] = [{ name: 'main', kind: 'schema' }];
		objects.main = [{ name: 'other', kind: 'schema' }];

		const [walkSchema] = await handle.getChildren({ retainNodes: true });
		const [walkChild] = await handle.nodeGetChildren(walkSchema.nodeHandle);
		const [paneSchema] = await handle.getChildren();
		await handle.getChildren();

		await expect(handle.nodeGetChildren(walkChild.nodeHandle)).resolves.toEqual([]);
		await expect(handle.nodeGetChildren(paneSchema.nodeHandle)).rejects.toThrow('Unknown node handle');

		handle.releaseNodes([walkSchema.nodeHandle, walkChild.nodeHandle]);
		await handle.getChildren();
		await expect(handle.nodeGetChildren(walkChild.nodeHandle)).rejects.toThrow('Unknown node handle');
	});

	it('honors an explicit has_children and defaults it only when absent', async () => {
		objects[''] = [
			{ name: 'files', kind: 'volume', has_children: false },
			{ name: 'main', kind: 'schema', has_children: true },
			{ name: 'other', kind: 'schema' },
		];

		const nodes = await handle.getChildren();

		expect(nodes.map(node => [node.name, node.hasGetChildren])).toEqual([
			['files', false],
			['main', true],
			['other', true],
		]);
	});

	// The connections package reports one stand-in catalog named after the connection.
	it('skips a lone top-level container with the connection\'s name', async () => {
		objects[''] = [{ name: 'SQLiteConnection', kind: 'catalog' }];
		objects.SQLiteConnection = [{ name: 'main', kind: 'schema' }];
		objects['SQLiteConnection/main'] = [{ name: 'mtcars', kind: 'table' }];

		const [schema] = await handle.getChildren();
		expect(schema.name).toBe('main');
		await handle.nodeGetChildren(schema.nodeHandle);

		const listRequests = requests.filter(request => request.method === 'list_objects');
		expect(listRequests[listRequests.length - 1].params.path).toEqual([
			{ name: 'SQLiteConnection', kind: 'catalog' },
			{ name: 'main', kind: 'schema' },
		]);
	});

	it.each([
		['a lone container with another name', [{ name: 'hive', kind: 'catalog' }], ['hive']],
		['a same-name container with siblings', [{ name: 'SQLiteConnection', kind: 'catalog' }, { name: 'other', kind: 'catalog' }], ['SQLiteConnection', 'other']],
		['a lone same-name table', [{ name: 'SQLiteConnection', kind: 'table' }], ['SQLiteConnection']],
	])('keeps %s at the top level', async (_label, topLevel, expected) => {
		objects[''] = topLevel;

		const nodes = await handle.getChildren();

		expect(nodes.map(node => node.name)).toEqual(expected);
	});

	it('keeps unknown kinds in the request path', async () => {
		objects[''] = [{ name: 'bq', kind: 'dataset' }];

		const [node] = await handle.getChildren();
		expect(node.kind).toBe('schema');
		await handle.nodeGetChildren(node.nodeHandle);

		const listRequests = requests.filter(request => request.method === 'list_objects');
		expect(listRequests[listRequests.length - 1].params.path).toEqual([{ name: 'bq', kind: 'dataset' }]);
	});

	it('previews through the runtime and reports no dataset id', async () => {
		objects[''] = [{ name: 'mtcars', kind: 'table' }];
		dataPaths.add('mtcars');

		const [node] = await handle.getChildren();
		expect(await handle.nodePreview(node.nodeHandle)).toBeUndefined();
		expect(requests.find(request => request.method === 'preview_object')?.params.path).toEqual([
			{ name: 'mtcars', kind: 'table' },
		]);
	});

	it('disconnect closes the comm once', async () => {
		const disposeSpy = vi.spyOn(client, 'dispose');

		await handle.disconnect();
		await handle.disconnect();

		expect(disposeSpy).toHaveBeenCalledTimes(1);
		expect(onDidDisconnect).toHaveBeenCalledTimes(1);
		expect(await handle.isConnected()).toBe(false);
	});

	it('release does not close the comm', async () => {
		const disposeSpy = vi.spyOn(client, 'dispose');

		handle.release();

		expect(disposeSpy).not.toHaveBeenCalled();
		expect(await handle.isConnected()).toBe(true);
	});

	it('reports a comm closed by the runtime', async () => {
		const closed = vi.fn();
		disposables.add(handle.onDidClose(closed));

		testClient.setClientState(RuntimeClientState.Closed);

		expect(closed).toHaveBeenCalledTimes(1);
		expect(await handle.isConnected()).toBe(false);
	});
});
