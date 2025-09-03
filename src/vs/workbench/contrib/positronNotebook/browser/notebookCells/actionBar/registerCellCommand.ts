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
import { ContextKeyExpression } from '../../../../../../platform/contextkey/common/contextkey.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { POSITRON_NOTEBOOK_EDITOR_FOCUSED } from '../../../../../services/positronNotebook/browser/ContextKeysManager.js';
import { IPositronNotebookCommandKeybinding } from './commandUtils.js';
import { CellConditionPredicate, createCellInfo } from './cellConditions.js';
import { IPositronNotebookInstance } from '../../../../../services/positronNotebook/browser/IPositronNotebookInstance.js';


/**
 * Configuration for action bar UI registration.
 */
export type ICellActionBarOptions = {
	/** Category of the action bar item. Items that share the same category
	 * will be grouped together. Ignored for "main" position actions. */
	category?: string;
	/** Sort order within position (lower numbers appear first) */
	order?: number;
	/** Visibility condition using VS Code context keys */
	when?: ContextKeyExpression;
} & ({
	/** Location in UI - main action bar */
	position: 'main';
	/** Codicon class for the button icon - required for main position */
	icon: string;
} | {
	/** Location in UI - dropdown menu */
	position: 'menu';
	/** Codicon class for the button icon - optional for menu position */
	icon?: string;
});

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
	actionBar?: ICellActionBarOptions;

	/** Optional keybinding configuration */
	keybinding?: IPositronNotebookCommandKeybinding;

	/** Optional command metadata including description, args, and return type. As passed to CommandsRegistry.registerCommand. */
	metadata?: ICommandMetadata;
}

/**
 * Helper function to register a command that operates on notebook cells.
 * Automatically handles getting the selected cell(s) from the active notebook.
 * Optionally registers the command in the cell action bar UI.
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
	metadata
}: IRegisterCellCommandOptions): IDisposable {
	const disposables = new DisposableStore();

	// Helper to check if a cell passes the cell condition
	const cellPassesCondition = (cell: IPositronNotebookCell, activeNotebook: any) => {
		if (!cellCondition) {
			return true;
		}

		const cells = activeNotebook.cells.get();
		const cellIndex = cells.indexOf(cell);
		if (cellIndex === -1) {
			return false;
		}

		const cellInfo = createCellInfo(cell, cellIndex, cells.length);
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
				const selectedCells = activeNotebook.selectionStateMachine.getSelectedCells();

				// Filter cells based on cell condition and execute handler
				for (const cell of selectedCells) {
					if (cellPassesCondition(cell, activeNotebook)) {
						handler(cell, activeNotebook, accessor);
					}
				}
			} else {
				// Handle single cell
				const cell = activeNotebook.selectionStateMachine.getSelectedCell();
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
			needsCellContext: true,  // Always true for cell commands
			cellCondition  // Pass cell condition to action bar registry
		};

		const uiDisposable = NotebookCellActionBarRegistry.getInstance().register(uiItem);
		disposables.add(uiDisposable);
	}

	// Optionally register keybinding
	if (keybinding) {
		const keybindingDisposable = KeybindingsRegistry.registerKeybindingRule({
			id: commandId,
			weight: keybinding.weight ?? KeybindingWeight.EditorContrib,
			when: keybinding.when ?? POSITRON_NOTEBOOK_EDITOR_FOCUSED,
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
