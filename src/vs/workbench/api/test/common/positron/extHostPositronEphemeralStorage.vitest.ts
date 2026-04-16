/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />


import { mock } from '../../../../../base/test/common/mock.js';
import { SingleProxyRPCProtocol } from '../testRPCProtocol.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { ExtHostPositronEphemeralStorage } from '../../../common/positron/extHostPositronEphemeralStorage.js';
import { MainThreadPositronEphemeralStorageShape } from '../../../common/positron/extHost.positron.protocol.js';

function createMockShape() {
	return new class extends mock<MainThreadPositronEphemeralStorageShape>() {
		private data = new Map<string, string>();
		override $initializeEphemeralStorage(extensionId: string): Promise<string | undefined> {
			return Promise.resolve(this.data.get(extensionId));
		}
		override $setEphemeralValue(extensionId: string, value: string): Promise<void> {
			this.data.set(extensionId, value);
			return Promise.resolve();
		}
		override $deleteEphemeralValue(extensionId: string): Promise<void> {
			this.data.delete(extensionId);
			return Promise.resolve();
		}
		setRaw(extensionId: string, value: string): void {
			this.data.set(extensionId, value);
		}
	};
}

describe('ExtHostPositronEphemeralStorage', function () {

	const disposables = ensureNoLeakedDisposables();

	let shape: ReturnType<typeof createMockShape>;

	beforeEach(() => {
		shape = createMockShape();
	});

	it('initializeEphemeralStorage returns defaultValue when nothing stored', async function () {
		const storage = new ExtHostPositronEphemeralStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const result = await storage.initializeEphemeralStorage('test.ext', { key: 'default' });
		expect(result).toEqual({ key: 'default' });
	});

	it('initializeEphemeralStorage returns parsed stored value', async function () {
		shape.setRaw('test.ext', JSON.stringify({ hello: 'world' }));
		const storage = new ExtHostPositronEphemeralStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const result = await storage.initializeEphemeralStorage('test.ext');
		expect(result).toEqual({ hello: 'world' });
	});

	it('initializeEphemeralStorage returns defaultValue on invalid JSON', async function () {
		shape.setRaw('test.ext', '{invalid json!!!');
		const errors: string[] = [];
		const logService = new class extends NullLogService {
			override error(message: string | Error): void {
				errors.push(typeof message === 'string' ? message : message.message);
			}
		};
		const storage = new ExtHostPositronEphemeralStorage(SingleProxyRPCProtocol(shape), logService);
		const result = await storage.initializeEphemeralStorage('test.ext', { fallback: true });
		expect(result).toEqual({ fallback: true });
		expect(errors.length).toBeGreaterThan(0);
	});

	it('getOrCreateMemento returns same instance for same extensionId', function () {
		const storage = new ExtHostPositronEphemeralStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const m1 = storage.getOrCreateMemento('test.ext');
		disposables.add(m1);
		const m2 = storage.getOrCreateMemento('test.ext');
		expect(m1).toBe(m2);
	});

	it('getOrCreateMemento returns different instances for different extensionIds', function () {
		const storage = new ExtHostPositronEphemeralStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const m1 = storage.getOrCreateMemento('ext.a');
		disposables.add(m1);
		const m2 = storage.getOrCreateMemento('ext.b');
		disposables.add(m2);
		expect(m1).not.toBe(m2);
	});
});

describe('EphemeralExtensionMemento', function () {

	const disposables = ensureNoLeakedDisposables();

	let shape: ReturnType<typeof createMockShape>;

	beforeEach(() => {
		shape = createMockShape();
	});

	it('whenReady resolves with the memento', async function () {
		const storage = new ExtHostPositronEphemeralStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento = storage.getOrCreateMemento('test.ext');
		disposables.add(memento);
		const resolved = await memento.whenReady;
		expect(resolved).toBe(memento);
	});

	it('get returns undefined for missing key', async function () {
		const storage = new ExtHostPositronEphemeralStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento = storage.getOrCreateMemento('test.ext');
		disposables.add(memento);
		await memento.whenReady;
		expect(memento.get('nonexistent')).toBe(undefined);
	});

	it('get returns defaultValue for missing key', async function () {
		const storage = new ExtHostPositronEphemeralStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento = storage.getOrCreateMemento('test.ext');
		disposables.add(memento);
		await memento.whenReady;
		expect(memento.get('nonexistent', 'fallback')).toBe('fallback');
	});

	it('update and get roundtrip', async function () {
		const storage = new ExtHostPositronEphemeralStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento = storage.getOrCreateMemento('test.ext');
		disposables.add(memento);
		await memento.whenReady;
		await memento.update('myKey', 42);
		expect(memento.get('myKey')).toBe(42);
	});

	it('update deep-clones object values', async function () {
		const storage = new ExtHostPositronEphemeralStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento = storage.getOrCreateMemento('test.ext');
		disposables.add(memento);
		await memento.whenReady;

		const obj = { nested: { value: 1 } };
		await memento.update('obj', obj);

		// Mutate the original object
		obj.nested.value = 999;

		// Stored value should be unaffected
		expect(memento.get('obj')).toEqual({ nested: { value: 1 } });
	});

	it('keys filters out undefined values', async function () {
		const storage = new ExtHostPositronEphemeralStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento = storage.getOrCreateMemento('test.ext');
		disposables.add(memento);
		await memento.whenReady;

		await memento.update('key1', 'value');
		await memento.update('key2', undefined);

		const keys = memento.keys();
		expect(keys).toContain('key1');
		expect(keys).not.toContain('key2');
	});

	it('update persists to storage', async function () {
		const storage1 = new ExtHostPositronEphemeralStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento1 = storage1.getOrCreateMemento('test.ext');
		disposables.add(memento1);
		await memento1.whenReady;

		await memento1.update('persistKey', 'persistValue');

		// Create a second ExtHostPositronEphemeralStorage instance using the same proxy shape
		// to bypass the memento cache and verify that the value was persisted to the backend.
		const storage2 = new ExtHostPositronEphemeralStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento2 = storage2.getOrCreateMemento('test.ext');
		disposables.add(memento2);
		await memento2.whenReady;

		expect(memento2.get('persistKey')).toBe('persistValue');
	});

	it('clear removes all keys and deletes from backend', async function () {
		const storage1 = new ExtHostPositronEphemeralStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento1 = storage1.getOrCreateMemento('test.ext');
		disposables.add(memento1);
		await memento1.whenReady;

		await memento1.update('a', 1);
		await memento1.update('b', 2);

		await memento1.clear();
		expect(memento1.keys()).toEqual([]);

		// Create a fresh storage + memento from the same proxy to verify backend is cleared
		const storage2 = new ExtHostPositronEphemeralStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento2 = storage2.getOrCreateMemento('test.ext');
		disposables.add(memento2);
		await memento2.whenReady;

		expect(memento2.keys()).toEqual([]);
		expect(memento2.get('a')).toBe(undefined);
	});

	it('dispose does not throw', async function () {
		const storage = new ExtHostPositronEphemeralStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento = storage.getOrCreateMemento('test.ext');
		disposables.add(memento);
		await memento.whenReady;

		// Verify dispose does not throw.
		// The ensureNoLeakedDisposables check will catch leaks if we forget dispose.
		memento.dispose();
	});

	it('dispose then getOrCreateMemento returns fresh working instance', async function () {
		const storage = new ExtHostPositronEphemeralStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento1 = storage.getOrCreateMemento('test.ext');
		disposables.add(memento1);
		await memento1.whenReady;

		await memento1.update('key', 'before-dispose');
		memento1.dispose();

		const memento2 = storage.getOrCreateMemento('test.ext');
		disposables.add(memento2);
		expect(memento1).not.toBe(memento2);
		await memento2.whenReady;

		// Fresh instance should see persisted state and accept new writes
		expect(memento2.get('key')).toBe('before-dispose');
		await memento2.update('key', 'after-dispose');
		expect(memento2.get('key')).toBe('after-dispose');
	});

	it('initializeEphemeralStorage rejects non-object stored values', async function () {
		const errors: string[] = [];
		const logService = new class extends NullLogService {
			override error(message: string | Error): void {
				errors.push(typeof message === 'string' ? message : message.message);
			}
		};

		for (const bad of ['42', '"hello"', 'true', '[1,2]', 'null']) {
			errors.length = 0;
			shape.setRaw('test.ext', bad);

			const storage = new ExtHostPositronEphemeralStorage(SingleProxyRPCProtocol(shape), logService);
			const memento = storage.getOrCreateMemento('test.ext');
			disposables.add(memento);
			await memento.whenReady;

			expect(memento.keys()).toEqual([]);
			expect(errors.length).toBeGreaterThan(0);
		}
	});
});
