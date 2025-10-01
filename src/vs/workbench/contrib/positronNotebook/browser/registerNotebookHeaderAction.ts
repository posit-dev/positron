/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ThemeIcon } from '../../../../base/common/themables.js';
import { IDisposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICommandActionTitle, PositronActionBarOptions } from '../../../../platform/action/common/action.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr, ContextKeyExpression } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IPositronNotebookService } from '../../../services/positronNotebook/browser/positronNotebookService.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED } from '../../../services/positronNotebook/browser/ContextKeysManager.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../common/positronNotebookCommon.js';

/**
 * Options for registering a notebook header action.
 * Similar to registerCellCommand but for notebook-level operations that don't target specific cells.
 */
export interface IRegisterNotebookHeaderActionOptions {
	/** The unique command identifier */
	commandId: string;

	/** The title for the action (displayed in command palette and tooltips) */
	title: string | ICommandActionTitle;

	/** Optional icon for the action */
	icon?: ThemeIcon;

	/** The function to execute when the action is invoked */
	handler: (notebook: IPositronNotebookInstance, accessor: ServicesAccessor) => void;

	/** Optional Positron action bar display options */
	positronActionBarOptions?: PositronActionBarOptions;

	/** Optional menu contribution configuration */
	menu?: {
		/** Menu location (EditorActionsLeft or EditorActionsRight) */
		id: MenuId;
		/** Menu group (typically 'navigation' for primary actions) */
		group?: string;
		/** Sort order within the group */
		order?: number;
		/** Visibility condition using context keys */
		when?: ContextKeyExpression;
	};

	/** Optional keybinding configuration (for future use) */
	keybinding?: {
		/** Primary keybinding */
		primary?: number;
		/** Secondary keybindings */
		secondary?: number[];
		/** Platform-specific overrides - primary is required if specified */
		mac?: { primary: number; secondary?: number[] };
		win?: { primary: number; secondary?: number[] };
		linux?: { primary: number; secondary?: number[] };
		/** Visibility condition for keybinding */
		when?: ContextKeyExpression;
		/** Keybinding weight (defaults to EditorContrib) */
		weight?: number;
	};
}

/**
 * Helper function to register a command that operates on the active notebook instance.
 * This is similar to registerCellCommand but for notebook-level operations.
 *
 * Features:
 * - Automatically gets the active notebook from IPositronNotebookService
 * - Registers command with CommandsRegistry
 * - Optionally registers menu contribution (for editor action bar)
 * - Optionally registers keybinding (for keyboard shortcuts)
 *
 * Example:
 * ```typescript
 * registerNotebookHeaderAction({
 *   commandId: 'positronNotebook.runAllCells',
 *   title: { value: localize('runAllCells', 'Run All'), original: 'Run All' },
 *   icon: ThemeIcon.fromId('notebook-execute-all'),
 *   handler: (notebook) => notebook.runAllCells(),
 *   menu: {
 *     id: MenuId.EditorActionsLeft,
 *     group: 'navigation',
 *     order: 10
 *   }
 * });
 * ```
 *
 * @param options Configuration for the notebook header action
 * @returns Disposable to unregister the command, menu, and keybinding
 */
export function registerNotebookHeaderAction(options: IRegisterNotebookHeaderActionOptions): IDisposable {
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
		}
	});
	disposables.add(commandDisposable);

	// Optionally register menu contribution
	if (options.menu) {
		// Default when clause: only show when Positron notebook is the active editor
		// We use ActiveEditorContext instead of POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED because
		// the action bar is rendered at the editor pane level, before focus is established
		const when = options.menu.when ?? ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID);

		const menuDisposable = MenuRegistry.appendMenuItem(options.menu.id, {
			command: {
				id: options.commandId,
				title: options.title,
				icon: options.icon,
				positronActionBarOptions: options.positronActionBarOptions
			},
			group: options.menu.group ?? 'navigation',
			order: options.menu.order,
			when
		});
		disposables.add(menuDisposable);
	}

	// Optionally register keybinding
	if (options.keybinding) {
		// Default to requiring notebook focus for keybindings
		const defaultWhen = POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED;
		const when = options.keybinding.when ?? defaultWhen;

		const keybindingDisposable = KeybindingsRegistry.registerKeybindingRule({
			id: options.commandId,
			weight: options.keybinding.weight ?? KeybindingWeight.EditorContrib,
			when,
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
