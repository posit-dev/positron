/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr, ContextKeyExpression } from '../../../../platform/contextkey/common/contextkey.js';
import { PositronActionBarWidgetRegistry } from '../../../../platform/positronActionBar/browser/positronActionBarWidgetRegistry.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../common/positronNotebookCommon.js';
import { NotebookInstanceProvider } from './NotebookInstanceProvider.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { getNotebookInstanceFromActiveEditorPane } from './notebookUtils.js';

/**
 * Options for registering a notebook widget (React component without command).
 */
interface INotebookWidgetOptions {
	/**
	 * Unique identifier for this widget.
	 * Used for React keying and error reporting.
	 */
	id: string;

	/**
	 * Widget definition.
	 * The component will be automatically wrapped in a NotebookInstanceProvider,
	 * so it can use the useNotebookInstance() hook to access the active notebook.
	 */
	widget: {
		component: React.ComponentType;
		/**
		 * Optional command to execute when widget is clicked.
		 * If specified, the widget becomes a command-driven button:
		 * - Widget component is purely presentational
		 * - Button wrapper provides accessibility
		 * - Cannot be used with selfContained
		 */
		commandId?: string;
		/**
		 * Optional arguments to pass to the command when executed.
		 * Only used if commandId is specified.
		 */
		commandArgs?: unknown;
		/**
		 * Optional ARIA label for the widget button.
		 * Required if commandId is specified.
		 */
		ariaLabel?: string;
		/**
		 * Optional tooltip for the widget button.
		 */
		tooltip?: string;
		/**
		 * If true, widget manages its own interaction and accessibility.
		 * Use for complex widgets with custom interactions.
		 * Cannot be used with commandId.
		 * Default: false
		 */
		selfContained?: boolean;
	};

	/**
	 * Menu location and visibility configuration (required for widgets).
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
		 */
		order: number;
	};

	/**
	 * Visibility condition using context keys (optional).
	 * Defaults to `activeEditor === POSITRON_NOTEBOOK_EDITOR_ID`.
	 */
	when?: ContextKeyExpression;

	/** Ensure command properties are not mixed with widgets */
	commandId?: never;
	handler?: never;
	metadata?: never;
	keybinding?: never;
}

export function registerNotebookWidget(options: INotebookWidgetOptions): IDisposable {
	// Validate that commandId and selfContained are not used together
	if (options.widget.commandId && options.widget.selfContained) {
		throw new Error(`Widget '${options.id}' cannot specify both commandId and selfContained`);
	}

	// Validate that commandId requires ariaLabel
	if (options.widget.commandId && !options.widget.ariaLabel) {
		throw new Error(`Widget '${options.id}' with commandId must specify ariaLabel`);
	}

	return PositronActionBarWidgetRegistry.registerWidget({
		id: options.id,
		menuId: options.menu.id,
		order: options.menu.order,
		// Default when clause: only show when Positron notebook is the active editor
		when: options.when ?? ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID),

		// Pass through command options
		commandId: options.widget.commandId,
		commandArgs: options.widget.commandArgs,
		ariaLabel: options.widget.ariaLabel,
		tooltip: options.widget.tooltip,
		selfContained: options.widget.selfContained,

		// Factory that wraps the component in NotebookInstanceProvider
		componentFactory: (accessor) => {
			// Return a wrapper component that provides notebook context
			return () => {
				// Get the active notebook using the VS Code pattern
				const editorService = accessor.get(IEditorService);
				const notebook = getNotebookInstanceFromActiveEditorPane(editorService);
				if (!notebook) {
					return null;
				}

				// Get the user's component
				const Component = options.widget.component;

				// Wrap in NotebookInstanceProvider so useNotebookInstance() hook works
				return (
					<NotebookInstanceProvider instance={notebook} >
						<Component />
					</NotebookInstanceProvider>
				);
			};
		}
	});
}
