/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mock } from '../../../../../base/test/common/mock.js';
import { SingleProxyRPCProtocol } from '../testRPCProtocol.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ExtHostPositronWindowStorage } from '../../../common/positron/extHostPositronWindowStorage.js';
import { MainThreadPositronWindowStorageShape } from '../../../common/positron/extHost.positron.protocol.js';

function createMockShape() {
	return new class extends mock<MainThreadPositronWindowStorageShape>() {
		private data = new Map<string, string>();
		override $initializeWindowStorage(extensionId: string): Promise<string | undefined> {
			return Promise.resolve(this.data.get(extensionId));
		}
		override $setWindowValue(extensionId: string, value: string): Promise<void> {
			this.data.set(extensionId, value);
			return Promise.resolve();
		}
		override $deleteWindowValue(extensionId: string): Promise<void> {
			this.data.delete(extensionId);
			return Promise.resolve();
		}
		setRaw(extensionId: string, value: string): void {
			this.data.set(extensionId, value);
		}
	};
}

suite('ExtHostPositronWindowStorage', function () {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let shape: ReturnType<typeof createMockShape>;

	setup(() => {
		shape = createMockShape();
	});

	test('initializeWindowStorage returns defaultValue when nothing stored', async function () {
		const storage = new ExtHostPositronWindowStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const result = await storage.initializeWindowStorage('test.ext', { key: 'default' });
		assert.deepStrictEqual(result, { key: 'default' });
	});

	test('initializeWindowStorage returns parsed stored value', async function () {
		shape.setRaw('test.ext', JSON.stringify({ hello: 'world' }));
		const storage = new ExtHostPositronWindowStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const result = await storage.initializeWindowStorage('test.ext');
		assert.deepStrictEqual(result, { hello: 'world' });
	});

	test('initializeWindowStorage returns defaultValue on invalid JSON', async function () {
		shape.setRaw('test.ext', '{invalid json!!!');
		const errors: string[] = [];
		const logService = new class extends NullLogService {
			override error(message: string | Error): void {
				errors.push(typeof message === 'string' ? message : message.message);
			}
		};
		const storage = new ExtHostPositronWindowStorage(SingleProxyRPCProtocol(shape), logService);
		const result = await storage.initializeWindowStorage('test.ext', { fallback: true });
		assert.deepStrictEqual(result, { fallback: true });
		assert.ok(errors.length > 0, 'Expected an error to be logged');
	});

	test('getOrCreateMemento returns same instance for same extensionId', function () {
		const storage = new ExtHostPositronWindowStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const m1 = storage.getOrCreateMemento('test.ext');
		disposables.add(m1);
		const m2 = storage.getOrCreateMemento('test.ext');
		assert.strictEqual(m1, m2);
	});

	test('getOrCreateMemento returns different instances for different extensionIds', function () {
		const storage = new ExtHostPositronWindowStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const m1 = storage.getOrCreateMemento('ext.a');
		disposables.add(m1);
		const m2 = storage.getOrCreateMemento('ext.b');
		disposables.add(m2);
		assert.notStrictEqual(m1, m2);
	});
});

suite('WindowExtensionMemento', function () {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let shape: ReturnType<typeof createMockShape>;

	setup(() => {
		shape = createMockShape();
	});

	test('whenReady resolves with the memento', async function () {
		const storage = new ExtHostPositronWindowStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento = storage.getOrCreateMemento('test.ext');
		disposables.add(memento);
		const resolved = await memento.whenReady;
		assert.strictEqual(resolved, memento);
	});

	test('get returns undefined for missing key', async function () {
		const storage = new ExtHostPositronWindowStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento = storage.getOrCreateMemento('test.ext');
		disposables.add(memento);
		await memento.whenReady;
		assert.strictEqual(memento.get('nonexistent'), undefined);
	});

	test('get returns defaultValue for missing key', async function () {
		const storage = new ExtHostPositronWindowStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento = storage.getOrCreateMemento('test.ext');
		disposables.add(memento);
		await memento.whenReady;
		assert.strictEqual(memento.get('nonexistent', 'fallback'), 'fallback');
	});

	test('update and get roundtrip', async function () {
		const storage = new ExtHostPositronWindowStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento = storage.getOrCreateMemento('test.ext');
		disposables.add(memento);
		await memento.whenReady;
		await memento.update('myKey', 42);
		assert.strictEqual(memento.get('myKey'), 42);
	});

	test('update deep-clones object values', async function () {
		const storage = new ExtHostPositronWindowStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento = storage.getOrCreateMemento('test.ext');
		disposables.add(memento);
		await memento.whenReady;

		const obj = { nested: { value: 1 } };
		await memento.update('obj', obj);

		// Mutate the original object
		obj.nested.value = 999;

		// Stored value should be unaffected
		assert.deepStrictEqual(memento.get('obj'), { nested: { value: 1 } });
	});

	test('keys filters out undefined values', async function () {
		const storage = new ExtHostPositronWindowStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento = storage.getOrCreateMemento('test.ext');
		disposables.add(memento);
		await memento.whenReady;

		await memento.update('key1', 'value');
		await memento.update('key2', undefined);

		const keys = memento.keys();
		assert.ok(keys.includes('key1'));
		assert.ok(!keys.includes('key2'));
	});

	test('update persists to storage', async function () {
		const storage1 = new ExtHostPositronWindowStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento1 = storage1.getOrCreateMemento('test.ext');
		disposables.add(memento1);
		await memento1.whenReady;

		await memento1.update('persistKey', 'persistValue');

		// Create a second ExtHostPositronWindowStorage instance using the same proxy shape
		// to bypass the memento cache and verify that the value was persisted to the backend.
		const storage2 = new ExtHostPositronWindowStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento2 = storage2.getOrCreateMemento('test.ext');
		disposables.add(memento2);
		await memento2.whenReady;

		assert.strictEqual(memento2.get('persistKey'), 'persistValue');
	});

	test('clear removes all keys and deletes from backend', async function () {
		const storage1 = new ExtHostPositronWindowStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento1 = storage1.getOrCreateMemento('test.ext');
		disposables.add(memento1);
		await memento1.whenReady;

		await memento1.update('a', 1);
		await memento1.update('b', 2);

		await memento1.clear();
		assert.deepStrictEqual(memento1.keys(), []);

		// Create a fresh storage + memento from the same proxy to verify backend is cleared
		const storage2 = new ExtHostPositronWindowStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento2 = storage2.getOrCreateMemento('test.ext');
		disposables.add(memento2);
		await memento2.whenReady;

		assert.deepStrictEqual(memento2.keys(), []);
		assert.strictEqual(memento2.get('a'), undefined);
	});

	test('dispose does not throw', async function () {
		const storage = new ExtHostPositronWindowStorage(SingleProxyRPCProtocol(shape), new NullLogService());
		const memento = storage.getOrCreateMemento('test.ext');
		disposables.add(memento);
		await memento.whenReady;

		// Verify dispose does not throw.
		// The ensureNoDisposablesAreLeakedInTestSuite check will catch leaks if we forget dispose.
		memento.dispose();
	});
});
