/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mock } from '../../../../../base/test/common/mock.js';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';
import { EphemeralStateService } from '../../../../../platform/ephemeralState/common/ephemeralStateService.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IExtHostContext } from '../../../../services/extensions/common/extHostCustomers.js';
import { MainThreadPositronEphemeralStorage } from '../../../browser/positron/mainThreadPositronEphemeralStorage.js';


const TEST_WORKSPACE_ID = 'test-workspace-id';

function createMockWorkspaceContextService(): IWorkspaceContextService {
	return new class extends mock<IWorkspaceContextService>() {
		override getWorkspace() {
			return { id: TEST_WORKSPACE_ID, folders: [] } as any;
		}
	};
}

suite('MainThreadPositronEphemeralStorage', function () {

	createTestContainer().build();

	let ephemeralStateService: EphemeralStateService;
	let storage: MainThreadPositronEphemeralStorage;
	const mockExtHostContext = new class extends mock<IExtHostContext>() { };
	const mockWorkspaceContextService = createMockWorkspaceContextService();

	setup(function () {
		ephemeralStateService = new EphemeralStateService();
		storage = new MainThreadPositronEphemeralStorage(mockExtHostContext, ephemeralStateService, mockWorkspaceContextService);
	});

	teardown(function () {
		storage.dispose();
	});

	test('$initializeEphemeralStorage returns undefined when nothing stored', async function () {
		const result = await storage.$initializeEphemeralStorage('ext.a');
		assert.strictEqual(result, undefined);
	});

	test('$setEphemeralValue and $initializeEphemeralStorage roundtrip', async function () {
		await storage.$setEphemeralValue('ext.a', 'hello world');
		const result = await storage.$initializeEphemeralStorage('ext.a');
		assert.strictEqual(result, 'hello world');
	});

	test('$deleteEphemeralValue removes stored value', async function () {
		await storage.$setEphemeralValue('ext.a', 'some value');
		const before = await storage.$initializeEphemeralStorage('ext.a');
		assert.strictEqual(before, 'some value');

		await storage.$deleteEphemeralValue('ext.a');
		const after = await storage.$initializeEphemeralStorage('ext.a');
		assert.strictEqual(after, undefined);
	});

	test('storage keys are scoped by workspaceId', async function () {
		await storage.$setEphemeralValue('ext.a', 'test-value');

		const result = await storage.$initializeEphemeralStorage('ext.a');
		assert.strictEqual(result, 'test-value');

		const expectedKey = `ephemeralStorage.${TEST_WORKSPACE_ID}.ext.a`;
		const directValue = await ephemeralStateService.getItem<string>(expectedKey);
		assert.strictEqual(directValue, 'test-value');
	});

	test('storage keys are scoped by extensionId', async function () {
		await storage.$setEphemeralValue('ext.a', 'value-a');
		await storage.$setEphemeralValue('ext.b', 'value-b');

		const resultA = await storage.$initializeEphemeralStorage('ext.a');
		const resultB = await storage.$initializeEphemeralStorage('ext.b');

		assert.strictEqual(resultA, 'value-a');
		assert.strictEqual(resultB, 'value-b');
	});

	test('different workspaces get isolated storage', async function () {
		// Store a value using the default workspace
		await storage.$setEphemeralValue('ext.a', 'workspace-1-value');

		// Create a second storage instance with a different workspace ID
		const otherWorkspaceService = new class extends mock<IWorkspaceContextService>() {
			override getWorkspace() {
				return { id: 'other-workspace-id', folders: [] } as any;
			}
		};
		const storage2 = new MainThreadPositronEphemeralStorage(mockExtHostContext, ephemeralStateService, otherWorkspaceService);

		// The second workspace should not see the first workspace's value
		const result = await storage2.$initializeEphemeralStorage('ext.a');
		assert.strictEqual(result, undefined);

		// And can store its own value independently
		await storage2.$setEphemeralValue('ext.a', 'workspace-2-value');
		assert.strictEqual(await storage2.$initializeEphemeralStorage('ext.a'), 'workspace-2-value');
		assert.strictEqual(await storage.$initializeEphemeralStorage('ext.a'), 'workspace-1-value');

		storage2.dispose();
	});

	test('dispose does not throw', function () {
		const instance = new MainThreadPositronEphemeralStorage(mockExtHostContext, ephemeralStateService, mockWorkspaceContextService);
		assert.doesNotThrow(() => instance.dispose());
	});
});
