/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { IDisposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICommandActionTitle, PositronActionBarOptions } from '../../../../platform/action/common/action.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ICommandMetadata, CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr, ContextKeyExpression } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { PositronActionBarWidgetRegistry } from '../../../../platform/positronActionBar/browser/positronActionBarWidgetRegistry.js';
import { POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED } from './ContextKeysManager.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../common/positronNotebookCommon.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { NotebookInstanceProvider } from './NotebookInstanceProvider.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { getNotebookInstanceFromEditorPane } from './notebookUtils.js';

/**
 * Keybinding configuration for notebook actions.
 * Similar to IPositronNotebookCommandKeybinding but without 'when' clause
 * (which is handled at the top level).
 */
interface INotebookActionKeybinding {
	/** Primary keybinding */
	primary?: number;
	/** Secondary keybindings */
	secondary?: number[];
	/** Platform-specific overrides - primary is required if specified */
	mac?: { primary: number; secondary?: number[] };
	win?: { primary: number; secondary?: number[] };
	linux?: { primary: number; secondary?: number[] };
	/** Keybinding weight (defaults to EditorContrib) */
	weight?: number;
	/**
	 * Optional custom when clause for this keybinding.
	 * If specified, this overrides the default keybinding context condition.
	 * If not specified, defaults to POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED.
	 */
	when?: ContextKeyExpression;
}

/**
 * Options for registering a notebook command (with optional menu UI and keybindings).
 */
interface INotebookCommandOptions {
	/** The unique command identifier */
	commandId: string;

	/** The function to execute when the command is invoked */
	handler: (notebook: IPositronNotebookInstance, accessor: ServicesAccessor) => void;

	/** Optional command metadata including description, args, and return type */
	metadata?: ICommandMetadata;

	/** Optional menu contribution (for editor action bar display) */
	menu?: {
		/** Menu location (typically EditorActionsLeft or EditorActionsRight) */
		id: MenuId;
		/** Menu group (typically 'navigation' for primary actions) */
		group?: string;
		/** Sort order within the group */
		order?: number;
		/** The title for the action (displayed in command palette and tooltips) */
		title: string | ICommandActionTitle;
		/** Optional icon for the action */
		icon?: ThemeIcon;
		/** Optional Positron action bar display options */
		positronActionBarOptions?: PositronActionBarOptions;
	};

	/** Optional keybinding configuration */
	keybinding?: INotebookActionKeybinding;

	/**
	 * Visibility condition using context keys (optional).
	 * When specified, this condition applies to BOTH menu visibility AND keybinding activation.
	 * - Menu default: `activeEditor === POSITRON_NOTEBOOK_EDITOR_ID`
	 * - Keybinding default: `POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED`
	 */
	when?: ContextKeyExpression;

	/** Ensure widget properties are not mixed with commands */
	widget?: never;
	id?: never;
}

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

/**
 * Unified type for registering notebook actions.
 * Can be either a command (with optional UI) or a widget (UI only).
 */
export type IRegisterNotebookActionOptions =
	| INotebookCommandOptions
	| INotebookWidgetOptions;

/**
 * Unified helper function to register notebook-level actions.
 *
 * This function handles two distinct use cases:
 *
 * 1. **Commands** - Register a command that operates on the notebook instance
 *    - Automatically gets the active notebook from IPositronNotebookService
 *    - Optionally registers menu contribution (for editor action bar)
 *    - Optionally registers keybinding (for keyboard shortcuts)
 *
 * 2. **Widgets** - Register a React component for the notebook action bar
 *    - Automatically wraps component in NotebookInstanceProvider
 *    - Component can use useNotebookInstance() hook
 *    - No command registration (UI only)
 *
 * Features:
 * - Type-safe discriminated union prevents mixing incompatible options
 * - Unified `when` clause controls both menu and keybinding visibility
 * - Default context conditions for menus and keybindings
 * - Follows established patterns from registerCellCommand
 *
 * @example Command with menu and keybinding
 * ```typescript
 * registerNotebookAction({
 *   commandId: 'positronNotebook.runAllCells',
 *   handler: (notebook) => notebook.runAllCells(),
 *   menu: {
 *     id: MenuId.EditorActionsLeft,
 *     order: 10,
 *     title: { value: localize('runAll', 'Run All'), original: 'Run All' },
 *     icon: ThemeIcon.fromId('notebook-execute-all')
 *   },
 *   keybinding: {
 *     primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter
 *   }
 * });
 * ```
 *
 * @example Command with keybinding only
 * ```typescript
 * registerNotebookAction({
 *   commandId: 'positronNotebook.selectDown',
 *   handler: (notebook) => notebook.selectionStateMachine.moveDown(false),
 *   keybinding: {
 *     primary: KeyCode.DownArrow
 *   }
 * });
 * ```
 *
 * @example Widget (React component)
 * ```typescript
 * registerNotebookAction({
 *   id: 'positronNotebook.kernelStatus',
 *   widget: {
 *     component: KernelStatusBadge
 *   },
 *   menu: {
 *     id: MenuId.EditorActionsRight,
 *     order: 100
 *   }
 * });
 * ```
 *
 * @param options Configuration for the notebook action (command or widget)
 * @returns Disposable to unregister the action
 */
export function registerNotebookAction(options: IRegisterNotebookActionOptions): IDisposable {
	// Type narrowing: check if this is a widget registration
	if ('widget' in options && options.widget) {
		return registerNotebookWidgetInternal(options);
	}

	// Otherwise, it's a command registration
	return registerNotebookCommandInternal(options);
}

/**
 * Internal implementation for registering notebook commands.
 */
function registerNotebookCommandInternal(options: INotebookCommandOptions): IDisposable {
	const disposables = new DisposableStore();

	// Register the command
	const commandDisposable = CommandsRegistry.registerCommand({
		id: options.commandId,
		handler: (accessor: ServicesAccessor) => {
			const editorService = accessor.get(IEditorService);
			const activeNotebook = getNotebookInstanceFromEditorPane(editorService);
			if (!activeNotebook) {
				return;
			}

			options.handler(activeNotebook, accessor);
		},
		metadata: options.metadata
	});
	disposables.add(commandDisposable);

	// Optionally register menu contribution
	if (options.menu) {
		// Default when clause: only show when Positron notebook is the active editor
		// We use ActiveEditorContext instead of POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED because
		// the action bar is rendered at the editor pane level, before focus is established
		const defaultMenuWhen = ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID);
		const menuWhen = options.when
			? ContextKeyExpr.and(options.when, defaultMenuWhen)
			: defaultMenuWhen;

		const menuDisposable = MenuRegistry.appendMenuItem(options.menu.id, {
			command: {
				id: options.commandId,
				title: options.menu.title,
				icon: options.menu.icon,
				positronActionBarOptions: options.menu.positronActionBarOptions
			},
			group: options.menu.group,
			order: options.menu.order,
			when: menuWhen
		});
		disposables.add(menuDisposable);
	}

	// Optionally register keybinding
	if (options.keybinding) {
		// Default to requiring notebook focus for keybindings
		const defaultKeybindingWhen = POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED;
		const keybindingWhen: ContextKeyExpression = options.keybinding.when ?? (
			options.when
				? ContextKeyExpr.and(options.when, defaultKeybindingWhen) ?? defaultKeybindingWhen
				: defaultKeybindingWhen
		);

		const keybindingDisposable = KeybindingsRegistry.registerKeybindingRule({
			id: options.commandId,
			weight: options.keybinding.weight ?? KeybindingWeight.EditorContrib,
			when: keybindingWhen,
			primary: options.keybinding.primary,
			secondary: options.keybinding.secondary,
			mac: options.keybinding.mac,
			win: options.keybinding.win,
			linux: options.keybinding.linux
		});
		disposables.add(keybindingDisposable);
	}

	return disposables;
}

/**
 * Internal implementation for registering notebook widgets.
 */
function registerNotebookWidgetInternal(options: INotebookWidgetOptions): IDisposable {
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
				const notebook = getNotebookInstanceFromEditorPane(editorService);
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
