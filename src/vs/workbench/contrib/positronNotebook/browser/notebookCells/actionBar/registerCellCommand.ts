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
import { CellConditionPredicate, createCellInfo } from './cellConditions.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { getSelectedCell, getSelectedCells, getEditingCell } from '../../selectionMachine.js';
import { ContextKeyExpr } from '../../../../../../platform/contextkey/common/contextkey.js';

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

	/** Cell-specific condition that determines if this command applies to a given cell */
	cellCondition?: CellConditionPredicate;

	/** Optional UI registration for the action bar */
	actionBar?: Omit<INotebookCellActionBarItem, 'commandId'>;

	/** Optional keybinding configuration */
	keybinding?: IPositronNotebookCommandKeybinding;

	/** Optional command metadata including description, args, and return type. As passed to CommandsRegistry.registerCommand. */
	metadata?: ICommandMetadata;

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
	cellCondition,
	actionBar,
	keybinding,
	metadata,
	editMode
}: IRegisterCellCommandOptions): IDisposable {
	const disposables = new DisposableStore();

	// Helper to check if a cell passes the cell condition
	const cellPassesCondition = (cell: IPositronNotebookCell, activeNotebook: IPositronNotebookInstance) => {
		if (!cellCondition) {
			return true;
		}

		if (cell.index === -1) {
			return false;
		}

		const cells = activeNotebook.cells.get();
		const cellInfo = createCellInfo(cell, cells.length);
		return cellCondition(cellInfo);
	};

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

				// Filter cells based on cell condition and execute handler
				for (const cell of selectedCells) {
					if (cellPassesCondition(cell, activeNotebook)) {
						handler(cell, activeNotebook, accessor);
					}
				}
			} else {
				// Handle single cell
				const state = activeNotebook.selectionStateMachine.state.get();
				// Get the selected cell and/or the editing cell if edit mode is enabled
				const cell = getSelectedCell(state) || (editMode ? getEditingCell(state) : undefined);
				if (cell && cellPassesCondition(cell, activeNotebook)) {
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
			when: actionBar.when,
			cellCondition  // Pass cell condition to action bar registry
		};

		const uiDisposable = NotebookCellActionBarRegistry.getInstance().register(uiItem);
		disposables.add(uiDisposable);
	}

	// Optionally register keybinding
	if (keybinding) {
		// Determine the when condition based on edit mode
		const defaultCondition = editMode ?
			ContextKeyExpr.or(
				POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
				POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED
			) :
			POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED;

		const keybindingDisposable = KeybindingsRegistry.registerKeybindingRule({
			id: commandId,
			weight: keybinding.weight ?? KeybindingWeight.EditorContrib,
			when: keybinding.when ?? defaultCondition,
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
