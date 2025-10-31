/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CommandsRegistry, ICommandMetadata } from '../../../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { NotebookCellActionBarRegistry, INotebookCellActionBarItem } from './actionBarRegistry.js';
import { IDisposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED, POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED } from '../../ContextKeysManager.js';
import { IPositronNotebookCommandKeybinding } from './commandUtils.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { getSelectedCell, getSelectedCells, getEditingCell } from '../../selectionMachine.js';
import { ContextKeyExpr, ContextKeyExpression } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { getNotebookInstanceFromActiveEditorPane } from '../../notebookUtils.js';

/**
 * Options for registering a cell command.
 */
export interface IRegisterCellCommandOptions {
	/** The unique command identifier */
	commandId: string;

	/** The function to execute when the command is invoked, receives the active notebook instance and services accessor */
	handler: (cell: IPositronNotebookCell, notebook: IPositronNotebookInstance, accessor: ServicesAccessor) => void;

	/** If true, handler is called for each selected cell */
	multiSelect?: boolean;

	/** Optional UI registration for the action bar */
	actionBar?: Omit<INotebookCellActionBarItem, 'commandId' | 'when'>;

	/** Optional keybinding configuration */
	keybinding?: Omit<IPositronNotebookCommandKeybinding, 'when'>;

	/** Optional command metadata including description, args, and return type. As passed to CommandsRegistry.registerCommand. */
	metadata?: ICommandMetadata;

	/** Visibility condition using context keys (optional).
	 *
	 * For action bar items: The `when` condition is used as-is without modification, allowing action bar items
	 * to remain visible and clickable even when the cell is in edit mode.
	 *
	 * For keybindings: The `when` condition is combined with edit mode restrictions based on the `editMode` option:
	 * - When `editMode: false` (default): Keybindings only work when the notebook container is focused (not when cell editor is focused)
	 * - When `editMode: true`: Keybindings work when either the container or cell editor is focused
	 *
	 * Note: Users should not directly include `POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED` in their `when` condition.
	 * Edit mode restrictions are handled automatically via the `editMode` option for keybindings only.
	*/
	when?: ContextKeyExpression;

	/** If true, also consider the editing cell when no selected cell is found */
	editMode?: boolean;
}

/**
 * Helper function to register a command that operates on notebook cells.
 * Automatically handles getting the selected cell(s) from the active notebook.
 * Optionally registers the command in the cell action bar UI.
 *
 * When `editMode: true` is set, the command will combine the existing keybinding condition
 * with `POSITRON_NOTEBOOK_HAS_FOCUS` (using OR logic). This ensures the shortcut works in
 * both the original context AND when focus is on the notebook container or inside a cell's Monaco editor.
 *
 * @param commandId The command ID to register
 * @param handler The function to execute with the selected cell(s)
 * @param options Optional configuration for the command and UI
 * @param metadata Optional command metadata including description, args, and return type. As passed to CommandsRegistry.registerCommand.
 * @returns Disposable to unregister both command and UI
 */
export function registerCellCommand({
	commandId,
	handler,
	multiSelect,
	actionBar,
	keybinding,
	when,
	metadata,
	editMode
}: IRegisterCellCommandOptions): IDisposable {
	const disposables = new DisposableStore();

	// Register the command
	const commandDisposable = CommandsRegistry.registerCommand({
		id: commandId,
		handler: (accessor: ServicesAccessor) => {
			const editorService = accessor.get(IEditorService);
			const activeNotebook = getNotebookInstanceFromActiveEditorPane(editorService);
			if (!activeNotebook) {
				return;
			}

			if (multiSelect) {
				// Handle multiple selected cells
				const selectedCells = getSelectedCells(activeNotebook.selectionStateMachine.state.get());

				for (const cell of selectedCells) {
					handler(cell, activeNotebook, accessor);
				}
			} else {
				// Handle single cell
				const state = activeNotebook.selectionStateMachine.state.get();
				// Always check editing cell if actionBar is present (action bar items should work in edit mode).
				// Otherwise, only check editing cell if editMode option is enabled.
				const cell = getSelectedCell(state) || ((actionBar || editMode) ? getEditingCell(state) : undefined);
				if (cell) {
					handler(cell, activeNotebook, accessor);
				}
			}
		},
		metadata: metadata
	});
	disposables.add(commandDisposable);

	// Optionally register UI metadata
	if (actionBar) {
		const humanReadableLabel = String(metadata?.description ?? commandId);
		// For action bar items, use `when` as-is without adding edit mode restrictions.
		// Edit mode restrictions are only applied to keybindings via the `editMode` option.
		const uiItem: INotebookCellActionBarItem = {
			commandId,
			label: humanReadableLabel,
			icon: actionBar.icon,
			position: actionBar.position,
			category: actionBar.category,
			order: actionBar.order,
			when
		};

		const uiDisposable = NotebookCellActionBarRegistry.getInstance().register(uiItem);
		disposables.add(uiDisposable);
	}

	// Optionally register keybinding
	if (keybinding) {
		// Determine the when condition based on edit mode.
		// For keybindings, we add edit mode restrictions:
		// - When `editMode: false` (default): Only allow shortcuts when container is focused (not when cell editor is focused)
		// - When `editMode: true`: Allow shortcuts when either container or cell editor is focused
		const defaultCondition = editMode ?
			ContextKeyExpr.or(
				POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
				POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED
			) :
			POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED;

		// Combine top-level `when` with keybinding.when (or default) using AND when both exist
		const combinedKbWhen = when ? ContextKeyExpr.and(when, defaultCondition) : defaultCondition;

		const keybindingDisposable = KeybindingsRegistry.registerKeybindingRule({
			id: commandId,
			weight: keybinding.weight ?? KeybindingWeight.EditorContrib,
			when: combinedKbWhen,
			primary: keybinding.primary,
			secondary: keybinding.secondary,
			mac: keybinding.mac,
			win: keybinding.win,
			linux: keybinding.linux
		});
		disposables.add(keybindingDisposable);
	}

	return disposables;
}
