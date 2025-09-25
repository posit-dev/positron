/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CommandsRegistry, ICommandMetadata } from '../../../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IPositronNotebookService } from '../../../../../services/positronNotebook/browser/positronNotebookService.js';
import { IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { NotebookCellActionBarRegistry, INotebookCellActionBarItem } from './actionBarRegistry.js';
import { IDisposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED, POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED } from '../../../../../services/positronNotebook/browser/ContextKeysManager.js';
import { IPositronNotebookCommandKeybinding } from './commandUtils.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { getSelectedCell, getSelectedCells, getEditingCell } from '../../selectionMachine.js';
import { ContextKeyExpr, ContextKeyExpression } from '../../../../../../platform/contextkey/common/contextkey.js';

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

	/** Visibility condition using context keys (optional). Defaults to `POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED` when not specified.
	 * When the command is not an "editMode" command, then the keybinding will only run when the cell editor is not focused.
	 * This is equivalent to the `and(<your when condition>, POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED.toNegated())` condition.
	 * This is so you dont have to specify not(editor focused) for the majority of commands.
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
			const notebookService = accessor.get(IPositronNotebookService);
			const activeNotebook = notebookService.getActiveInstance();
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
				// Get the selected cell and/or the editing cell if edit mode is enabled
				const cell = getSelectedCell(state) || (editMode ? getEditingCell(state) : undefined);
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
		// Determine the when condition based on edit mode
		const defaultCondition = editMode ?
			POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED :
			ContextKeyExpr.and( // When the command is not an "editMode" command, don't let it run when the cell editor is focused
				POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
				POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED.toNegated()
			);

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
