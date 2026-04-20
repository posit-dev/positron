/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';
import { IVariableItem } from '../../../positronVariables/common/interfaces/variableItem.js';
import { IPositronDataExplorerInstance } from '../../browser/interfaces/positronDataExplorerInstance.js';
import { IPositronDataExplorerService } from '../../browser/interfaces/positronDataExplorerService.js';
import { viewVariableItem } from '../../browser/positronDataExplorerViewVariableItem.js';

const SESSION_ID = 'test-session-id';
const ITEM_ID = 'test-item-id';
const VIEWER_ID = 'test-viewer-id';

type MockItem = IVariableItem & { view: sinon.SinonStub };

const makeItem = (overrides: Partial<IVariableItem> = {}): MockItem => {
	return {
		id: ITEM_ID,
		path: [],
		view: sinon.stub().resolves(VIEWER_ID),
		...overrides,
	} as unknown as MockItem;
};

const makeDataExplorerService = (overrides: Partial<IPositronDataExplorerService> = {}) => {
	const service = {
		getInstanceForVar: sinon.stub().returns(undefined),
		getInstanceForVariablePath: sinon.stub().returns(undefined),
		setInstanceForVar: sinon.stub(),
		...overrides,
	};
	return service as unknown as IPositronDataExplorerService & {
		getInstanceForVar: sinon.SinonStub;
		getInstanceForVariablePath: sinon.SinonStub;
		setInstanceForVar: sinon.SinonStub;
	};
};

const makeNotificationService = () => {
	const service = { error: sinon.stub() };
	return service as unknown as INotificationService & { error: sinon.SinonStub };
};

const makeExistingInstance = () => {
	return { requestFocus: sinon.stub() } as unknown as IPositronDataExplorerInstance & {
		requestFocus: sinon.SinonStub;
	};
};

suite('viewVariableItem', () => {
	createTestContainer().build();

	test('focuses existing instance found by variable id', async () => {
		const existing = makeExistingInstance();
		const dataExplorerService = makeDataExplorerService({
			getInstanceForVar: sinon.stub().returns(existing),
		});
		const notificationService = makeNotificationService();
		const item = makeItem({ path: ['df'] });

		await viewVariableItem(SESSION_ID, item, dataExplorerService, notificationService);

		assert.strictEqual(existing.requestFocus.callCount, 1);
		assert.strictEqual(dataExplorerService.getInstanceForVariablePath.callCount, 0);
		assert.strictEqual(item.view.callCount, 0);
		assert.strictEqual(dataExplorerService.setInstanceForVar.callCount, 0);
	});

	test('focuses existing instance found by variable path when id lookup misses', async () => {
		const existing = makeExistingInstance();
		const dataExplorerService = makeDataExplorerService({
			getInstanceForVariablePath: sinon.stub().returns(existing),
		});
		const notificationService = makeNotificationService();
		const item = makeItem({ path: ['df'] });

		await viewVariableItem(SESSION_ID, item, dataExplorerService, notificationService);

		assert.strictEqual(existing.requestFocus.callCount, 1);
		assert.deepStrictEqual(
			dataExplorerService.getInstanceForVariablePath.firstCall.args,
			[SESSION_ID, ['df']],
		);
		assert.strictEqual(item.view.callCount, 0);
	});

	test('skips path lookup when item.path is empty', async () => {
		const dataExplorerService = makeDataExplorerService();
		const notificationService = makeNotificationService();
		const item = makeItem({ path: [] });

		await viewVariableItem(SESSION_ID, item, dataExplorerService, notificationService);

		assert.strictEqual(dataExplorerService.getInstanceForVariablePath.callCount, 0);
		assert.strictEqual(item.view.callCount, 1);
	});

	test('falls through to view() when neither id nor path lookup finds an instance', async () => {
		const dataExplorerService = makeDataExplorerService();
		const notificationService = makeNotificationService();
		const item = makeItem({ path: ['df'] });

		await viewVariableItem(SESSION_ID, item, dataExplorerService, notificationService);

		assert.deepStrictEqual(
			dataExplorerService.getInstanceForVariablePath.firstCall.args,
			[SESSION_ID, ['df']],
		);
		assert.strictEqual(item.view.callCount, 1);
	});

	test('binds viewer id to variable id on successful view()', async () => {
		const dataExplorerService = makeDataExplorerService();
		const notificationService = makeNotificationService();
		const item = makeItem();

		await viewVariableItem(SESSION_ID, item, dataExplorerService, notificationService);

		assert.strictEqual(item.view.callCount, 1);
		assert.deepStrictEqual(
			dataExplorerService.setInstanceForVar.firstCall.args,
			[VIEWER_ID, ITEM_ID],
		);
	});

	test('does not bind when view() resolves without a viewer id', async () => {
		const dataExplorerService = makeDataExplorerService();
		const notificationService = makeNotificationService();
		const item = makeItem({ view: sinon.stub().resolves(undefined) as unknown as IVariableItem['view'] });

		await viewVariableItem(SESSION_ID, item, dataExplorerService, notificationService);

		assert.strictEqual(dataExplorerService.setInstanceForVar.callCount, 0);
		assert.strictEqual(notificationService.error.callCount, 0);
	});

	test('notifies and does not bind when view() rejects', async () => {
		const dataExplorerService = makeDataExplorerService();
		const notificationService = makeNotificationService();
		const item = makeItem({
			view: sinon.stub().rejects(new Error('boom')) as unknown as IVariableItem['view'],
		});

		await viewVariableItem(SESSION_ID, item, dataExplorerService, notificationService);

		assert.strictEqual(notificationService.error.callCount, 1);
		assert.strictEqual(dataExplorerService.setInstanceForVar.callCount, 0);
	});
});
