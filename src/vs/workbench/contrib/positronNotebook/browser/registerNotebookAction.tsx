/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ThemeIcon } from '../../../../base/common/themables.js';
import { IDisposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICommandActionTitle, PositronActionBarOptions } from '../../../../platform/action/common/action.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ICommandMetadata, CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr, ContextKeyExpression } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IPositronNotebookService } from './positronNotebookService.js';
import { POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED } from './ContextKeysManager.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../common/positronNotebookCommon.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';

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

	/** Widgets will come later, so we don't need to support them yet */
	widget?: never;
	id?: never;
}

/**
 * Type for registering notebook actions.
 */
export type IRegisterNotebookActionOptions = INotebookCommandOptions;

/**
 * Helper function to register notebook-level actions.
 *
 * Registers a command that operates on the notebook instance:
 * - Automatically gets the active notebook from IPositronNotebookService
 * - Optionally registers menu contribution (for editor action bar)
 * - Optionally registers keybinding (for keyboard shortcuts)
 *
 * Features:
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
 * @param options Configuration for the notebook action
 * @returns Disposable to unregister the action
 */
export function registerNotebookAction(options: IRegisterNotebookActionOptions): IDisposable {
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
			const notebookService = accessor.get(IPositronNotebookService);
			const activeNotebook = notebookService.getActiveInstance();
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
			group: options.menu.group ?? 'navigation',
			order: options.menu.order,
			when: menuWhen
		});
		disposables.add(menuDisposable);
	}

	// Optionally register keybinding
	if (options.keybinding) {
		// Default to requiring notebook focus for keybindings
		const defaultKeybindingWhen = POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED;
		const keybindingWhen = options.when
			? ContextKeyExpr.and(options.when, defaultKeybindingWhen)
			: defaultKeybindingWhen;

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
