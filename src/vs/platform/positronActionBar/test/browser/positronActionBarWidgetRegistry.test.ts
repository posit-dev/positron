/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { MenuId } from '../../../actions/common/actions.js';
import { ContextKeyExpr, IContextKeyService } from '../../../contextkey/common/contextkey.js';
import { PositronActionBarWidgetRegistry, IPositronActionBarWidgetDescriptor } from '../../browser/positronActionBarWidgetRegistry.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('PositronActionBarWidgetRegistry', () => {
	let contextKeyService: IContextKeyService;
	let contextMatchesRulesStub: sinon.SinonStub;

	setup(() => {
		// Create a mock context key service
		contextMatchesRulesStub = sinon.stub().returns(true);
		contextKeyService = {
			contextMatchesRules: contextMatchesRulesStub
		} as unknown as IContextKeyService;
	});

	teardown(() => {
		sinon.restore();
	});

	test('registerWidget adds a widget to the registry', () => {
		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			componentFactory: () => () => null
		};

		const disposable = PositronActionBarWidgetRegistry.registerWidget(descriptor);

		const widgets = PositronActionBarWidgetRegistry.getWidgets(
			MenuId.EditorActionsRight,
			contextKeyService
		);

		assert.strictEqual(widgets.length, 1);
		assert.strictEqual(widgets[0].id, 'test.widget');

		disposable.dispose();
	});

	test('disposing registration removes widget from registry', () => {
		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.disposable',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			componentFactory: () => () => null
		};

		const disposable = PositronActionBarWidgetRegistry.registerWidget(descriptor);

		// Widget should be present
		let widgets = PositronActionBarWidgetRegistry.getWidgets(
			MenuId.EditorActionsRight,
			contextKeyService
		);
		assert.strictEqual(widgets.length, 1);

		// Dispose and verify it's gone
		disposable.dispose();
		widgets = PositronActionBarWidgetRegistry.getWidgets(
			MenuId.EditorActionsRight,
			contextKeyService
		);
		assert.strictEqual(widgets.length, 0);
	});

	test('getWidgets filters by MenuId', () => {
		const leftWidget: IPositronActionBarWidgetDescriptor = {
			id: 'left.widget',
			menuId: MenuId.EditorActionsLeft,
			order: 100,
			componentFactory: () => () => null
		};

		const rightWidget: IPositronActionBarWidgetDescriptor = {
			id: 'right.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			componentFactory: () => () => null
		};

		const disposable1 = PositronActionBarWidgetRegistry.registerWidget(leftWidget);
		const disposable2 = PositronActionBarWidgetRegistry.registerWidget(rightWidget);

		// Should only get left widget
		const leftWidgets = PositronActionBarWidgetRegistry.getWidgets(
			MenuId.EditorActionsLeft,
			contextKeyService
		);
		assert.strictEqual(leftWidgets.length, 1);
		assert.strictEqual(leftWidgets[0].id, 'left.widget');

		// Should only get right widget
		const rightWidgets = PositronActionBarWidgetRegistry.getWidgets(
			MenuId.EditorActionsRight,
			contextKeyService
		);
		assert.strictEqual(rightWidgets.length, 1);
		assert.strictEqual(rightWidgets[0].id, 'right.widget');

		disposable1.dispose();
		disposable2.dispose();
	});

	test('getWidgets filters by context key expression', () => {
		const alwaysVisible: IPositronActionBarWidgetDescriptor = {
			id: 'always.visible',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			componentFactory: () => () => null
		};

		const conditionalWidget: IPositronActionBarWidgetDescriptor = {
			id: 'conditional.widget',
			menuId: MenuId.EditorActionsRight,
			order: 200,
			when: ContextKeyExpr.equals('testKey', 'testValue'),
			componentFactory: () => () => null
		};

		const disposable1 = PositronActionBarWidgetRegistry.registerWidget(alwaysVisible);
		const disposable2 = PositronActionBarWidgetRegistry.registerWidget(conditionalWidget);

		// Mock context key service to return false for conditional widget
		contextMatchesRulesStub.callsFake((expr: any) => {
			return expr === undefined; // Only match widgets without 'when' clause
		});

		const widgets = PositronActionBarWidgetRegistry.getWidgets(
			MenuId.EditorActionsRight,
			contextKeyService
		);

		// Should only get the always-visible widget
		assert.strictEqual(widgets.length, 1);
		assert.strictEqual(widgets[0].id, 'always.visible');

		disposable1.dispose();
		disposable2.dispose();
	});

	test('getWidgets includes widget when context matches', () => {
		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'contextual.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			when: ContextKeyExpr.equals('testKey', 'testValue'),
			componentFactory: () => () => null
		};

		const disposable = PositronActionBarWidgetRegistry.registerWidget(descriptor);

		// Mock context key service to return true (context matches)
		contextMatchesRulesStub.returns(true);

		const widgets = PositronActionBarWidgetRegistry.getWidgets(
			MenuId.EditorActionsRight,
			contextKeyService
		);

		assert.strictEqual(widgets.length, 1);
		assert.strictEqual(widgets[0].id, 'contextual.widget');

		disposable.dispose();
	});

	test('getWidgets sorts by order ascending', () => {
		const widget300: IPositronActionBarWidgetDescriptor = {
			id: 'widget.300',
			menuId: MenuId.EditorActionsRight,
			order: 300,
			componentFactory: () => () => null
		};

		const widget100: IPositronActionBarWidgetDescriptor = {
			id: 'widget.100',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			componentFactory: () => () => null
		};

		const widget200: IPositronActionBarWidgetDescriptor = {
			id: 'widget.200',
			menuId: MenuId.EditorActionsRight,
			order: 200,
			componentFactory: () => () => null
		};

		const disposable1 = PositronActionBarWidgetRegistry.registerWidget(widget300);
		const disposable2 = PositronActionBarWidgetRegistry.registerWidget(widget100);
		const disposable3 = PositronActionBarWidgetRegistry.registerWidget(widget200);

		const widgets = PositronActionBarWidgetRegistry.getWidgets(
			MenuId.EditorActionsRight,
			contextKeyService
		);

		assert.strictEqual(widgets.length, 3);
		assert.strictEqual(widgets[0].id, 'widget.100');
		assert.strictEqual(widgets[1].id, 'widget.200');
		assert.strictEqual(widgets[2].id, 'widget.300');

		disposable1.dispose();
		disposable2.dispose();
		disposable3.dispose();
	});

	test('multiple widgets can be registered to same menuId', () => {
		const widget1: IPositronActionBarWidgetDescriptor = {
			id: 'widget.1',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			componentFactory: () => () => null
		};

		const widget2: IPositronActionBarWidgetDescriptor = {
			id: 'widget.2',
			menuId: MenuId.EditorActionsRight,
			order: 200,
			componentFactory: () => () => null
		};

		const widget3: IPositronActionBarWidgetDescriptor = {
			id: 'widget.3',
			menuId: MenuId.EditorActionsRight,
			order: 300,
			componentFactory: () => () => null
		};

		const disposable1 = PositronActionBarWidgetRegistry.registerWidget(widget1);
		const disposable2 = PositronActionBarWidgetRegistry.registerWidget(widget2);
		const disposable3 = PositronActionBarWidgetRegistry.registerWidget(widget3);

		const widgets = PositronActionBarWidgetRegistry.getWidgets(
			MenuId.EditorActionsRight,
			contextKeyService
		);

		assert.strictEqual(widgets.length, 3);

		disposable1.dispose();
		disposable2.dispose();
		disposable3.dispose();
	});

	test('getWidgets returns empty array for menuId with no widgets', () => {
		const widgets = PositronActionBarWidgetRegistry.getWidgets(
			MenuId.EditorActionsRight,
			contextKeyService
		);

		assert.strictEqual(widgets.length, 0);
	});

	// Ensure that all disposables are cleaned up.
	ensureNoDisposablesAreLeakedInTestSuite();
});
