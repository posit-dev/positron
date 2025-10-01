/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { MenuId } from '../../actions/common/actions.js';
import { ContextKeyExpression, IContextKeyService } from '../../contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../instantiation/common/instantiation.js';

/**
 * Descriptor for a custom React widget that can be contributed to the action bar.
 *
 * Widgets are stateful React components that display dynamic information in the action bar,
 * complementing actions (which are imperative commands). Examples include status indicators,
 * live data displays, and interactive UI elements.
 */
export interface IPositronActionBarWidgetDescriptor {
	/**
	 * Unique identifier for this widget.
	 * Used for keying React elements and error reporting.
	 */
	id: string;

	/**
	 * MenuId location where this widget should appear.
	 * Examples: MenuId.EditorActionsLeft, MenuId.EditorActionsRight
	 */
	menuId: MenuId;

	/**
	 * Sort order for this widget within the menu.
	 * Widgets and actions share the same order space and will be intermixed.
	 * Higher numbers appear further right (in left-to-right layouts).
	 */
	order: number;

	/**
	 * Optional visibility condition using context keys.
	 * Widget only appears when this expression evaluates to true.
	 * If not specified, widget is always visible.
	 */
	when?: ContextKeyExpression;

	/**
	 * Factory function that creates the React component for this widget.
	 *
	 * The factory receives a ServicesAccessor to access VS Code services,
	 * which can be used to get editor-specific context (e.g., active notebook instance).
	 *
	 * The returned component is responsible for:
	 * - Rendering the widget UI
	 * - Managing its own state
	 * - Accessing any needed context (via React Context or hooks)
	 *
	 * Note: Component is created per-render (not memoized), so keep factory lightweight.
	 *
	 * @param accessor Service accessor for getting VS Code services
	 * @returns React component type that will be rendered
	 */
	componentFactory: (accessor: ServicesAccessor) => React.ComponentType;
}

/**
 * Registry for custom React widgets that can be contributed to the Positron action bar.
 *
 * This registry allows extensions and core components to register stateful UI widgets
 * that appear alongside action buttons in the action bar. Widgets can:
 * - Display dynamic, live-updating information
 * - Respond to user interactions
 * - Access editor-specific context
 * - Control their own visibility via context key expressions
 *
 * Example usage:
 * ```typescript
 * PositronActionBarWidgetRegistry.registerWidget({
 *   id: 'my.widget',
 *   menuId: MenuId.EditorActionsRight,
 *   order: 100,
 *   when: ContextKeyExpr.equals('activeEditor', 'workbench.editor.myEditor'),
 *   componentFactory: (accessor) => {
 *     return () => {
 *       const myService = accessor.get(IMyService);
 *       return <MyWidgetComponent service={myService} />;
 *     };
 *   }
 * });
 * ```
 */
export interface IPositronActionBarWidgetRegistry {
	/**
	 * Register a widget with the action bar.
	 *
	 * @param descriptor Configuration for the widget
	 * @returns Disposable to unregister the widget
	 */
	registerWidget(descriptor: IPositronActionBarWidgetDescriptor): IDisposable;

	/**
	 * Get all widgets for a specific MenuId that match the current context.
	 *
	 * Widgets are filtered by:
	 * 1. MenuId - only widgets registered for this menu location
	 * 2. Context keys - only widgets whose `when` clause evaluates to true
	 *
	 * Results are sorted by order number (ascending).
	 *
	 * @param menuId The menu location to query
	 * @param contextKeyService Service for evaluating `when` clauses
	 * @returns Array of widget descriptors, sorted by order
	 */
	getWidgets(menuId: MenuId, contextKeyService: IContextKeyService): IPositronActionBarWidgetDescriptor[];
}

/**
 * Implementation of the Positron action bar widget registry.
 */
class PositronActionBarWidgetRegistryImpl implements IPositronActionBarWidgetRegistry {
	private widgets: IPositronActionBarWidgetDescriptor[] = [];

	registerWidget(descriptor: IPositronActionBarWidgetDescriptor): IDisposable {
		this.widgets.push(descriptor);

		return {
			dispose: () => {
				const index = this.widgets.indexOf(descriptor);
				if (index !== -1) {
					this.widgets.splice(index, 1);
				}
			}
		};
	}

	getWidgets(menuId: MenuId, contextKeyService: IContextKeyService): IPositronActionBarWidgetDescriptor[] {
		return this.widgets
			.filter(w => w.menuId.id === menuId.id)
			.filter(w => !w.when || contextKeyService.contextMatchesRules(w.when))
			.sort((a, b) => a.order - b.order);
	}
}

/**
 * Singleton instance of the widget registry.
 * Use this to register and query action bar widgets.
 */
export const PositronActionBarWidgetRegistry: IPositronActionBarWidgetRegistry = new PositronActionBarWidgetRegistryImpl();
