/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { mock } from '../../../../../base/test/common/mock.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { EphemeralStateService } from '../../../../../platform/ephemeralState/common/ephemeralStateService.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IExtHostContext } from '../../../../services/extensions/common/extHostCustomers.js';
import { MainThreadPositronEphemeralStorage } from '../../../browser/positron/mainThreadPositronEphemeralStorage.js';


const TEST_WORKSPACE_ID = 'test-workspace-id';

function createMockWorkspaceContextService(): IWorkspaceContextService {
	return new class extends mock<IWorkspaceContextService>() {
		override getWorkspace() {
			// eslint-disable-next-line local/code-no-any-casts -- partial IWorkspace for test; full stub deferred to follow-up cleanup PR
			return { id: TEST_WORKSPACE_ID, folders: [] } as any;
		}
	};
}

describe('MainThreadPositronEphemeralStorage', function () {

	createTestContainer().build();

	let ephemeralStateService: EphemeralStateService;
	let storage: MainThreadPositronEphemeralStorage;
	const mockExtHostContext = new class extends mock<IExtHostContext>() { };
	const mockWorkspaceContextService = createMockWorkspaceContextService();

	beforeEach(function () {
		ephemeralStateService = new EphemeralStateService();
		storage = new MainThreadPositronEphemeralStorage(mockExtHostContext, ephemeralStateService, mockWorkspaceContextService);
	});

	afterEach(function () {
		storage.dispose();
	});

	it('$initializeEphemeralStorage returns undefined when nothing stored', async function () {
		const result = await storage.$initializeEphemeralStorage('ext.a');
		expect(result).toBe(undefined);
	});

	it('$setEphemeralValue and $initializeEphemeralStorage roundtrip', async function () {
		await storage.$setEphemeralValue('ext.a', 'hello world');
		const result = await storage.$initializeEphemeralStorage('ext.a');
		expect(result).toBe('hello world');
	});

	it('$deleteEphemeralValue removes stored value', async function () {
		await storage.$setEphemeralValue('ext.a', 'some value');
		const before = await storage.$initializeEphemeralStorage('ext.a');
		expect(before).toBe('some value');

		await storage.$deleteEphemeralValue('ext.a');
		const after = await storage.$initializeEphemeralStorage('ext.a');
		expect(after).toBe(undefined);
	});

	it('storage keys are scoped by workspaceId', async function () {
		await storage.$setEphemeralValue('ext.a', 'test-value');

		const result = await storage.$initializeEphemeralStorage('ext.a');
		expect(result).toBe('test-value');

		const expectedKey = `ephemeralStorage.${TEST_WORKSPACE_ID}.ext.a`;
		const directValue = await ephemeralStateService.getItem<string>(expectedKey);
		expect(directValue).toBe('test-value');
	});

	it('storage keys are scoped by extensionId', async function () {
		await storage.$setEphemeralValue('ext.a', 'value-a');
		await storage.$setEphemeralValue('ext.b', 'value-b');

		const resultA = await storage.$initializeEphemeralStorage('ext.a');
		const resultB = await storage.$initializeEphemeralStorage('ext.b');

		expect(resultA).toBe('value-a');
		expect(resultB).toBe('value-b');
	});

	it('different workspaces get isolated storage', async function () {
		// Store a value using the default workspace
		await storage.$setEphemeralValue('ext.a', 'workspace-1-value');

		// Create a second storage instance with a different workspace ID
		const otherWorkspaceService = new class extends mock<IWorkspaceContextService>() {
			override getWorkspace() {
				// eslint-disable-next-line local/code-no-any-casts -- partial IWorkspace for test; full stub deferred to follow-up cleanup PR
				return { id: 'other-workspace-id', folders: [] } as any;
			}
		};
		const storage2 = new MainThreadPositronEphemeralStorage(mockExtHostContext, ephemeralStateService, otherWorkspaceService);

		// The second workspace should not see the first workspace's value
		const result = await storage2.$initializeEphemeralStorage('ext.a');
		expect(result).toBe(undefined);

		// And can store its own value independently
		await storage2.$setEphemeralValue('ext.a', 'workspace-2-value');
		expect(await storage2.$initializeEphemeralStorage('ext.a')).toBe('workspace-2-value');
		expect(await storage.$initializeEphemeralStorage('ext.a')).toBe('workspace-1-value');

		storage2.dispose();
	});

	it('dispose does not throw', function () {
		const instance = new MainThreadPositronEphemeralStorage(mockExtHostContext, ephemeralStateService, mockWorkspaceContextService);
		expect(() => instance.dispose()).not.toThrow();
	});
});
