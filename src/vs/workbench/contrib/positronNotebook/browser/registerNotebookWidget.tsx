/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr, ContextKeyExpression } from '../../../../platform/contextkey/common/contextkey.js';
import { PositronActionBarWidgetRegistry } from '../../../../platform/positronActionBar/browser/positronActionBarWidgetRegistry.js';
import { IPositronNotebookService } from '../../../services/positronNotebook/browser/positronNotebookService.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../common/positronNotebookCommon.js';
import { NotebookInstanceProvider } from './NotebookInstanceProvider.js';

/**
 * Options for registering a notebook-specific widget.
 */
export interface IRegisterNotebookWidgetOptions {
	/**
	 * Unique identifier for this widget.
	 * Used for React keying and error reporting.
	 */
	id: string;

	/**
	 * The React component to render in the action bar.
	 *
	 * This component will be automatically wrapped in a NotebookInstanceProvider,
	 * so it can use the useNotebookInstance() hook to access the active notebook.
	 *
	 * Example:
	 * ```typescript
	 * function MyWidget() {
	 *   const notebook = useNotebookInstance();
	 *   const status = useObservedValue(notebook.kernelStatus);
	 *   return <div>Status: {status}</div>;
	 * }
	 * ```
	 */
	component: React.ComponentType;

	/**
	 * Menu location and visibility configuration.
	 */
	menu: {
		/**
		 * MenuId location where widget should appear.
		 * Typically MenuId.EditorActionsLeft or MenuId.EditorActionsRight.
		 */
		id: MenuId;

		/**
		 * Sort order within the menu.
		 * Widgets and actions share the same order space and will be intermixed.
		 * Higher numbers appear further right (in left-to-right layouts).
		 */
		order: number;

		/**
		 * Optional visibility condition using context keys.
		 * If not specified, defaults to checking that active editor is a Positron notebook.
		 */
		when?: ContextKeyExpression;
	};
}

/**
 * Register a custom React widget for the notebook action bar.
 *
 * This helper simplifies contributing stateful UI components to the notebook's action bar.
 * The component will automatically have access to the notebook instance via React Context.
 *
 * Features:
 * - Automatically wraps component in NotebookInstanceProvider
 * - Component can use useNotebookInstance() hook
 * - Default visibility: only shown for Positron notebooks
 * - Widgets appear alongside action buttons
 * - Full React ecosystem available (hooks, effects, state, etc.)
 *
 * Example:
 * ```typescript
 * registerNotebookWidget({
 *   id: 'positronNotebook.kernelStatus',
 *   component: KernelStatusBadge,
 *   menu: {
 *     id: MenuId.EditorActionsRight,
 *     order: 100  // High order to appear at far right
 *   }
 * });
 * ```
 *
 * @param options Configuration for the notebook widget
 * @returns Disposable to unregister the widget
 */
export function registerNotebookWidget(options: IRegisterNotebookWidgetOptions): IDisposable {
	return PositronActionBarWidgetRegistry.registerWidget({
		id: options.id,
		menuId: options.menu.id,
		order: options.menu.order,
		// Default when clause: only show when Positron notebook is the active editor
		when: options.menu.when ?? ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID),

		// Factory that wraps the component in NotebookInstanceProvider
		componentFactory: (accessor) => {
			// Return a wrapper component that provides notebook context
			return () => {
				// Get the active notebook instance from the service
				const notebookService = accessor.get(IPositronNotebookService);
				const notebook = notebookService.getActiveInstance();

				// If no active notebook, don't render anything
				if (!notebook) {
					return null;
				}

				// Get the user's component
				const Component = options.component;

				// Wrap in NotebookInstanceProvider so useNotebookInstance() hook works
				return (
					<NotebookInstanceProvider instance={notebook}>
						<Component />
					</NotebookInstanceProvider>
				);
			};
		}
	});
}
