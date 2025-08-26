/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CommandsRegistry } from '../../../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IPositronNotebookService } from '../../../../../services/positronNotebook/browser/positronNotebookService.js';
import { IPositronNotebookCell } from '../../../../../services/positronNotebook/browser/IPositronNotebookCell.js';
import { NotebookCellActionBarRegistry, INotebookCellActionBarItem } from './actionBarRegistry.js';
import { IDisposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { ContextKeyExpression } from '../../../../../../platform/contextkey/common/contextkey.js';

/**
 * Options for registering a cell command.
 */
export interface IRegisterCellCommandOptions {
	/** If true, handler is called for each selected cell */
	multiSelect?: boolean;

	/** Optional UI registration for the action bar */
	actionBar?: {
		/** Codicon class for the button icon */
		icon: string;
		/** Location in UI - either main action bar or dropdown menu */
		position: 'main' | 'menu';
		/** Sort order within position (lower numbers appear first) */
		order?: number;
		/** Visibility condition using VS Code context keys */
		when?: ContextKeyExpression;
	};
}

/**
 * Helper function to register a command that operates on notebook cells.
 * Automatically handles getting the selected cell(s) from the active notebook.
 * Optionally registers the command in the cell action bar UI.
 *
 * @param commandId The command ID to register
 * @param handler The function to execute with the selected cell(s)
 * @param options Optional configuration for the command and UI
 * @returns Disposable to unregister both command and UI
 */
export function registerCellCommand(
	commandId: string,
	handler: (cell: IPositronNotebookCell, accessor: ServicesAccessor) => void,
	options?: IRegisterCellCommandOptions
): IDisposable {
	const disposables = new DisposableStore();

	// Register the command
	const commandDisposable = CommandsRegistry.registerCommand(commandId, (accessor: ServicesAccessor) => {
		const notebookService = accessor.get(IPositronNotebookService);
		const activeNotebook = notebookService.getActiveInstance();
		if (!activeNotebook) {
			return;
		}

		if (options?.multiSelect) {
			// Handle multiple selected cells
			const currentState = activeNotebook.selectionStateMachine.state.get();
			let selectedCells: IPositronNotebookCell[] = [];

			if (currentState.type === 'SingleSelection' || currentState.type === 'MultiSelection') {
				selectedCells = currentState.selected;
			} else if (currentState.type === 'EditingSelection') {
				selectedCells = [currentState.selectedCell];
			}

			for (const cell of selectedCells) {
				handler(cell, accessor);
			}
		} else {
			// Handle single cell
			const cell = activeNotebook.selectionStateMachine.getSelectedCell();
			if (cell) {
				handler(cell, accessor);
			}
		}
	});
	disposables.add(commandDisposable);

	// Optionally register UI metadata
	if (options?.actionBar) {
		const uiItem: INotebookCellActionBarItem = {
			commandId,
			icon: options.actionBar.icon,
			position: options.actionBar.position,
			order: options.actionBar.order,
			when: options.actionBar.when,
			needsCellContext: true  // Always true for cell commands
		};

		const uiDisposable = NotebookCellActionBarRegistry.getInstance().register(uiItem);
		disposables.add(uiDisposable);
	}

	return disposables;
}