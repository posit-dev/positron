/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import sinon from 'sinon';
import { MenuId } from '../../../actions/common/actions.js';
import { ContextKeyExpr, IContextKeyService } from '../../../contextkey/common/contextkey.js';
import { PositronActionBarWidgetRegistryImpl, IPositronActionBarWidgetDescriptor } from '../../browser/positronActionBarWidgetRegistry.js';
import { ensureNoLeakedDisposables } from '../../../../base/test/common/vitestSetup.js';

describe('PositronActionBarWidgetRegistry', () => {
	let registry: PositronActionBarWidgetRegistryImpl;
	let contextKeyService: IContextKeyService;
	let contextMatchesRulesStub: sinon.SinonStub;

	beforeEach(() => {
		// Create a fresh registry instance for each test to ensure isolation
		registry = new PositronActionBarWidgetRegistryImpl();

		// Create a mock context key service
		contextMatchesRulesStub = sinon.stub().returns(true);
		contextKeyService = {
			contextMatchesRules: contextMatchesRulesStub
		} as unknown as IContextKeyService;
	});

	afterEach(() => {
		sinon.restore();
	});

	it('registerWidget adds a widget to the registry', () => {
		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			componentFactory: () => () => null
		};

		const disposable = registry.registerWidget(descriptor);

		const widgets = registry.getWidgets(
			MenuId.EditorActionsRight,
			contextKeyService
		);

		expect(widgets.length).toBe(1);
		expect(widgets[0].id).toBe('test.widget');

		disposable.dispose();
	});

	it('disposing registration removes widget from registry', () => {
		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'test.disposable',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			componentFactory: () => () => null
		};

		const disposable = registry.registerWidget(descriptor);

		// Widget should be present
		let widgets = registry.getWidgets(
			MenuId.EditorActionsRight,
			contextKeyService
		);
		expect(widgets.length).toBe(1);

		// Dispose and verify it's gone
		disposable.dispose();
		widgets = registry.getWidgets(
			MenuId.EditorActionsRight,
			contextKeyService
		);
		expect(widgets.length).toBe(0);
	});

	it('getWidgets filters by MenuId', () => {
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

		const disposable1 = registry.registerWidget(leftWidget);
		const disposable2 = registry.registerWidget(rightWidget);

		// Should only get left widget
		const leftWidgets = registry.getWidgets(
			MenuId.EditorActionsLeft,
			contextKeyService
		);
		expect(leftWidgets.length).toBe(1);
		expect(leftWidgets[0].id).toBe('left.widget');

		// Should only get right widget
		const rightWidgets = registry.getWidgets(
			MenuId.EditorActionsRight,
			contextKeyService
		);
		expect(rightWidgets.length).toBe(1);
		expect(rightWidgets[0].id).toBe('right.widget');

		disposable1.dispose();
		disposable2.dispose();
	});

	it('getWidgets filters by context key expression', () => {
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

		const disposable1 = registry.registerWidget(alwaysVisible);
		const disposable2 = registry.registerWidget(conditionalWidget);

		// Mock context key service to return false for conditional widget
		contextMatchesRulesStub.callsFake((expr: any) => {
			return expr === undefined; // Only match widgets without 'when' clause
		});

		const widgets = registry.getWidgets(
			MenuId.EditorActionsRight,
			contextKeyService
		);

		// Should only get the always-visible widget
		expect(widgets.length).toBe(1);
		expect(widgets[0].id).toBe('always.visible');

		disposable1.dispose();
		disposable2.dispose();
	});

	it('getWidgets includes widget when context matches', () => {
		const descriptor: IPositronActionBarWidgetDescriptor = {
			id: 'contextual.widget',
			menuId: MenuId.EditorActionsRight,
			order: 100,
			when: ContextKeyExpr.equals('testKey', 'testValue'),
			componentFactory: () => () => null
		};

		const disposable = registry.registerWidget(descriptor);

		// Mock context key service to return true (context matches)
		contextMatchesRulesStub.returns(true);

		const widgets = registry.getWidgets(
			MenuId.EditorActionsRight,
			contextKeyService
		);

		expect(widgets.length).toBe(1);
		expect(widgets[0].id).toBe('contextual.widget');

		disposable.dispose();
	});

	it('getWidgets sorts by order ascending', () => {
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

		const disposable1 = registry.registerWidget(widget300);
		const disposable2 = registry.registerWidget(widget100);
		const disposable3 = registry.registerWidget(widget200);

		const widgets = registry.getWidgets(
			MenuId.EditorActionsRight,
			contextKeyService
		);

		expect(widgets.length).toBe(3);
		expect(widgets[0].id).toBe('widget.100');
		expect(widgets[1].id).toBe('widget.200');
		expect(widgets[2].id).toBe('widget.300');

		disposable1.dispose();
		disposable2.dispose();
		disposable3.dispose();
	});

	it('multiple widgets can be registered to same menuId', () => {
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

		const disposable1 = registry.registerWidget(widget1);
		const disposable2 = registry.registerWidget(widget2);
		const disposable3 = registry.registerWidget(widget3);

		const widgets = registry.getWidgets(
			MenuId.EditorActionsRight,
			contextKeyService
		);

		expect(widgets.length).toBe(3);

		disposable1.dispose();
		disposable2.dispose();
		disposable3.dispose();
	});

	it('getWidgets returns empty array for menuId with no widgets', () => {
		const widgets = registry.getWidgets(
			MenuId.EditorActionsRight,
			contextKeyService
		);

		expect(widgets.length).toBe(0);
	});

	// Ensure that all disposables are cleaned up.
	ensureNoLeakedDisposables();
});
