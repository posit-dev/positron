/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Mock } from 'vitest';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ConnectionsClientInstance } from '../../languageRuntime/common/languageRuntimeConnectionsClient.js';
import { IRuntimeClientOutput, RuntimeClientState, RuntimeClientType } from '../../languageRuntime/common/languageRuntimeClientInstance.js';
import { TestRuntimeClientInstance } from '../../languageRuntime/test/common/testRuntimeClientInstance.js';
import { IConnectionMetadata } from '../common/interfaces/positronConnectionsInstance.js';
import { IRuntimeConnectionEntry, RuntimeDataConnectionDriver } from '../browser/runtimeDataConnectionDriver.js';
import { RuntimeConnectionLanguage } from '../common/runtimeDataConnections.js';

describe('Positron - Runtime Data Connection Driver', () => {
	let disposables: DisposableStore;
	let onDidChange: Mock<() => void>;
	let driver: RuntimeDataConnectionDriver;
	let testClients: Map<string, TestRuntimeClientInstance>;

	function makeEntry(sessionId: string, clientId: string, sessionName: string, host?: string, extra?: Partial<IConnectionMetadata>, state = RuntimeClientState.Connected): IRuntimeConnectionEntry {
		const testClient = disposables.add(new TestRuntimeClientInstance(clientId, RuntimeClientType.Connection));
		testClient.setClientState(state);
		testClients.set(clientId, testClient);
		const client = new ConnectionsClientInstance(testClient);
		return { sessionId, sessionName, client, metadata: { name: 'mtcars db', language_id: 'r', host, ...extra } };
	}

	function commEvent(method: string): IRuntimeClientOutput<unknown> {
		return { data: { method, params: {} }, buffers: [] };
	}

	function connectParams(id: string) {
		return { connectionId: id };
	}

	beforeEach(() => {
		disposables = new DisposableStore();
		testClients = new Map();
		onDidChange = vi.fn<() => void>();
		driver = disposables.add(new RuntimeDataConnectionDriver('r', onDidChange));
	});

	afterEach(() => {
		disposables.dispose();
	});

	it('reports one discovery per comm, labelled with the session', async () => {
		driver.addConnection(makeEntry('s1', 'c1', 'R 4.5.1', 'localhost'));
		driver.addConnection(makeEntry('s1', 'c2', 'R 4.5.1', 'localhost'));
		driver.addConnection(makeEntry('s2', 'c3', 'R 4.4.0'));

		expect((await driver.discoverConnections()).map(({ id, description }) => ({ id, description }))).toEqual([
			{ id: 's1:c1', description: 'R 4.5.1 \u00B7 localhost' },
			{ id: 's1:c2', description: 'R 4.5.1 \u00B7 localhost' },
			{ id: 's2:c3', description: 'R 4.4.0' },
		]);
		expect((await driver.discoverConnections())[0]).toEqual({
			id: 's1:c1',
			name: 'mtcars db',
			description: 'R 4.5.1 \u00B7 localhost',
			mechanismId: 'live',
			parameterValues: { connectionId: 's1:c1' },
		});
	});

	it('exposes the driver metadata', () => {
		expect({ id: driver.id, metadataId: driver.metadata.id, name: driver.metadata.name, mechanisms: driver.metadata.mechanisms, supported: driver.metadata.supportedLanguageIds }).toEqual({
			id: 'runtime-r',
			metadataId: 'runtime-r',
			name: 'R Session',
			mechanisms: [{ id: 'live', label: 'Live', description: '', parameters: [{ id: 'connectionId', label: 'Connection', type: 'string' }] }],
			supported: [],
		});
		const python = disposables.add(new RuntimeDataConnectionDriver('python', () => { }));
		expect(python.metadata.name).toBe('Python Session');
		expect(python.metadata.iconSvg).toContain('<svg');
	});

	it('connect returns the same handle for the same comm', async () => {
		const id = driver.addConnection(makeEntry('s1', 'c1', 'R'));
		const first = await driver.connect('live', connectParams(id));
		const second = await driver.connect('live', connectParams(id));
		expect(second).toBe(first);
		expect(first.handle).toBeLessThan(0);
		expect(driver.getHandle(id)).toBe(first);
	});

	it('R and Python handles never share a number', async () => {
		const python = disposables.add(new RuntimeDataConnectionDriver('python', () => { }));
		const rId = driver.addConnection(makeEntry('s1', 'c1', 'R'));
		const pId = python.addConnection(makeEntry('s2', 'c2', 'Python'));
		const rHandle = await driver.connect('live', connectParams(rId));
		const pHandle = await python.connect('live', connectParams(pId));
		expect(rHandle.handle).not.toBe(pHandle.handle);
	});

	it('connect rejects for a closed comm', async () => {
		const id = driver.addConnection(makeEntry('s1', 'c1', 'R'));
		testClients.get('c1')!.setClientState(RuntimeClientState.Closed);

		await expect(driver.connect('live', connectParams(id))).rejects.toThrow(`No live runtime connection '${id}'`);
		expect(await driver.discoverConnections()).toEqual([]);
		expect(onDidChange).toHaveBeenCalledTimes(2);
	});

	it('does not hold a comm that is already closed', async () => {
		const entry = makeEntry('s1', 'c1', 'R', undefined, undefined, RuntimeClientState.Closed);
		const id = driver.addConnection(entry);

		expect(driver.hasConnection('s1', 'c1')).toBe(false);
		expect(await driver.discoverConnections()).toEqual([]);
		expect(onDidChange).not.toHaveBeenCalled();
		await expect(driver.connect('live', connectParams(id))).rejects.toThrow('No live runtime connection');
	});

	it('a user disconnect removes the entry once', async () => {
		const id = driver.addConnection(makeEntry('s1', 'c1', 'R'));
		const handle = await driver.connect('live', connectParams(id));
		const closed = vi.fn();
		disposables.add(handle.onDidClose(closed));

		await handle.disconnect();
		// The comm's own close arrives as well; the entry must not be removed twice.
		testClients.get('c1')!.setClientState(RuntimeClientState.Closed);

		expect(await driver.discoverConnections()).toEqual([]);
		expect(onDidChange).toHaveBeenCalledTimes(2);
		expect(driver.getHandle(id)).toBeUndefined();
		expect(closed).toHaveBeenCalledTimes(1);
	});

	it('a closed comm leaves its handle disconnected', async () => {
		const id = driver.addConnection(makeEntry('s1', 'c1', 'R'));
		const handle = await driver.connect('live', connectParams(id));
		const closed = vi.fn();
		disposables.add(handle.onDidClose(closed));

		testClients.get('c1')!.setClientState(RuntimeClientState.Closed);

		expect(await handle.isConnected()).toBe(false);
		expect(closed).toHaveBeenCalledTimes(1);
	});

	it('removeSession leaves the handle disconnected without closing the comm', async () => {
		const entry = makeEntry('s1', 'c1', 'R');
		const disposeClient = vi.spyOn(entry.client, 'dispose');
		const id = driver.addConnection(entry);
		const handle = await driver.connect('live', connectParams(id));
		const closed = vi.fn();
		disposables.add(handle.onDidClose(closed));

		driver.removeSession('s1');

		expect(await handle.isConnected()).toBe(false);
		expect(closed).toHaveBeenCalledTimes(1);
		expect(disposeClient).not.toHaveBeenCalled();
	});

	it('removeSession drops only that session\'s comms', async () => {
		driver.addConnection(makeEntry('s1', 'c1', 'R'));
		driver.addConnection(makeEntry('s1', 'c2', 'R'));
		driver.addConnection(makeEntry('s2', 'c3', 'R'));

		driver.removeSession('s1');
		driver.removeSession('s1');

		expect((await driver.discoverConnections()).map(_ => _.id)).toEqual(['s2:c3']);
		expect(onDidChange).toHaveBeenCalledTimes(5);
	});

	it('adding the same comm twice is a no-op', async () => {
		const entry = makeEntry('s1', 'c1', 'R');
		driver.addConnection(entry);
		driver.addConnection(entry);
		const focused: string[] = [];
		disposables.add(driver.onDidFocus(id => focused.push(id)));

		testClients.get('c1')!.receiveData(commEvent('focus'));

		expect(await driver.discoverConnections()).toHaveLength(1);
		expect(onDidChange).toHaveBeenCalledTimes(1);
		expect(driver.hasConnection('s1', 'c1')).toBe(true);
		expect(focused).toEqual(['s1:c1']);
	});

	it('forwards update events with the connection id', () => {
		driver.addConnection(makeEntry('s1', 'c1', 'R'));
		const updated: string[] = [];
		disposables.add(driver.onDidUpdate(id => updated.push(id)));

		testClients.get('c1')!.receiveData(commEvent('update'));

		expect(updated).toEqual(['s1:c1']);
	});

	it('generates no connection code', async () => {
		const id = driver.addConnection(makeEntry('s1', 'c1', 'R', undefined, { code: 'con <- dbConnect(odbc::odbc(), pwd = "secret")' }));

		expect(await driver.generateConnectionCode('live', 'r', connectParams(id))).toEqual([]);
		expect(driver.metadata.supportedLanguageIds).toEqual([]);
		expect(await driver.redactParameterValue('live', 'connectionId', id)).toBeUndefined();
		expect(await driver.validateParameters('live', connectParams(id))).toEqual({});
	});

	it('disposing the driver does not close any comm', async () => {
		const a = makeEntry('s1', 'c1', 'R');
		const b = makeEntry('s1', 'c2', 'R');
		const disposeA = vi.spyOn(a.client, 'dispose');
		const disposeB = vi.spyOn(b.client, 'dispose');
		driver.addConnection(a);
		const idB = driver.addConnection(b);
		await driver.connect('live', connectParams(idB));

		driver.dispose();

		expect(disposeA).not.toHaveBeenCalled();
		expect(disposeB).not.toHaveBeenCalled();
		expect(testClients.get('c1')!.clientState.get()).toBe(RuntimeClientState.Connected);
		expect(testClients.get('c2')!.clientState.get()).toBe(RuntimeClientState.Connected);
	});

	it('serves a language it was built for', () => {
		const language: RuntimeConnectionLanguage = 'python';
		expect(disposables.add(new RuntimeDataConnectionDriver(language, () => { })).id).toBe('runtime-python');
	});
});
