/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IVariableItem } from '../../../positronVariables/common/interfaces/variableItem.js';
import { IPositronDataExplorerInstance } from '../../browser/interfaces/positronDataExplorerInstance.js';
import { IPositronDataExplorerService } from '../../browser/interfaces/positronDataExplorerService.js';
import { viewVariableItem } from '../../browser/positronDataExplorerViewVariableItem.js';

const SESSION_ID = 'test-session-id';
const ITEM_ID = 'test-item-id';
const VIEWER_ID = 'test-viewer-id';

/* eslint-disable local/code-no-dangerous-type-assertions */
// Test doubles below cast minimal shapes to full service interfaces -- see the
// matching block in viewDataFrameAtCursorAction.vitest.ts for the rationale.

type MockItem = IVariableItem & { view: ReturnType<typeof vi.fn> };

const makeItem = (overrides: Partial<IVariableItem> = {}): MockItem =>
({
	id: ITEM_ID,
	path: [],
	view: vi.fn().mockResolvedValue(VIEWER_ID),
	...overrides,
} as unknown as MockItem);

const makeDataExplorerService = (overrides: Partial<IPositronDataExplorerService> = {}) => {
	const service = {
		getInstanceForVar: vi.fn().mockReturnValue(undefined),
		getInstanceForVariablePath: vi.fn().mockReturnValue(undefined),
		setInstanceForVar: vi.fn(),
		...overrides,
	};
	return service as unknown as IPositronDataExplorerService & {
		getInstanceForVar: ReturnType<typeof vi.fn>;
		getInstanceForVariablePath: ReturnType<typeof vi.fn>;
		setInstanceForVar: ReturnType<typeof vi.fn>;
	};
};

const makeNotificationService = () => {
	const service = { error: vi.fn() };
	return service as unknown as INotificationService & { error: ReturnType<typeof vi.fn> };
};

const makeExistingInstance = () =>
({ requestFocus: vi.fn() } as unknown as IPositronDataExplorerInstance & {
	requestFocus: ReturnType<typeof vi.fn>;
});
/* eslint-enable local/code-no-dangerous-type-assertions */

describe('viewVariableItem', () => {
	createTestContainer().build();

	it('focuses existing instance found by variable id', async () => {
		const existing = makeExistingInstance();
		const dataExplorerService = makeDataExplorerService({
			getInstanceForVar: vi.fn().mockReturnValue(existing) as unknown as IPositronDataExplorerService['getInstanceForVar'],
		});
		const notificationService = makeNotificationService();
		const item = makeItem({ path: ['df'] });

		await viewVariableItem(SESSION_ID, item, dataExplorerService, notificationService);

		expect(existing.requestFocus).toHaveBeenCalledTimes(1);
		expect(dataExplorerService.getInstanceForVariablePath).not.toHaveBeenCalled();
		expect(item.view).not.toHaveBeenCalled();
		expect(dataExplorerService.setInstanceForVar).not.toHaveBeenCalled();
	});

	it('focuses existing instance found by variable path when id lookup misses', async () => {
		const existing = makeExistingInstance();
		const dataExplorerService = makeDataExplorerService({
			getInstanceForVariablePath: vi.fn().mockReturnValue(existing) as unknown as IPositronDataExplorerService['getInstanceForVariablePath'],
		});
		const notificationService = makeNotificationService();
		const item = makeItem({ path: ['df'] });

		await viewVariableItem(SESSION_ID, item, dataExplorerService, notificationService);

		expect(existing.requestFocus).toHaveBeenCalledTimes(1);
		expect(dataExplorerService.getInstanceForVariablePath.mock.calls[0]).toEqual([SESSION_ID, ['df']]);
		expect(item.view).not.toHaveBeenCalled();
	});

	it('skips path lookup when item.path is empty', async () => {
		const dataExplorerService = makeDataExplorerService();
		const notificationService = makeNotificationService();
		const item = makeItem({ path: [] });

		await viewVariableItem(SESSION_ID, item, dataExplorerService, notificationService);

		expect(dataExplorerService.getInstanceForVariablePath).not.toHaveBeenCalled();
		expect(item.view).toHaveBeenCalledTimes(1);
	});

	it('falls through to view() when neither id nor path lookup finds an instance', async () => {
		const dataExplorerService = makeDataExplorerService();
		const notificationService = makeNotificationService();
		const item = makeItem({ path: ['df'] });

		await viewVariableItem(SESSION_ID, item, dataExplorerService, notificationService);

		expect(dataExplorerService.getInstanceForVariablePath.mock.calls[0]).toEqual([SESSION_ID, ['df']]);
		expect(item.view).toHaveBeenCalledTimes(1);
	});

	it('binds viewer id to variable id on successful view()', async () => {
		const dataExplorerService = makeDataExplorerService();
		const notificationService = makeNotificationService();
		const item = makeItem();

		await viewVariableItem(SESSION_ID, item, dataExplorerService, notificationService);

		expect(item.view).toHaveBeenCalledTimes(1);
		expect(dataExplorerService.setInstanceForVar.mock.calls[0]).toEqual([VIEWER_ID, ITEM_ID]);
	});

	it('does not bind when view() resolves without a viewer id', async () => {
		const dataExplorerService = makeDataExplorerService();
		const notificationService = makeNotificationService();
		const item = makeItem({ view: vi.fn().mockResolvedValue(undefined) as unknown as IVariableItem['view'] });

		await viewVariableItem(SESSION_ID, item, dataExplorerService, notificationService);

		expect(dataExplorerService.setInstanceForVar).not.toHaveBeenCalled();
		expect(notificationService.error).not.toHaveBeenCalled();
	});

	it('notifies and does not bind when view() rejects', async () => {
		const dataExplorerService = makeDataExplorerService();
		const notificationService = makeNotificationService();
		const item = makeItem({
			view: vi.fn().mockRejectedValue(new Error('boom')) as unknown as IVariableItem['view'],
		});

		await viewVariableItem(SESSION_ID, item, dataExplorerService, notificationService);

		expect(notificationService.error).toHaveBeenCalledTimes(1);
		expect(dataExplorerService.setInstanceForVar).not.toHaveBeenCalled();
	});
});
