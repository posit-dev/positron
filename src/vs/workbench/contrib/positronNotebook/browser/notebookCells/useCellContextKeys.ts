/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { autorun } from '../../../../../base/common/observable.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { CellKind, CellSelectionStatus, IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { IPositronNotebookInstance } from '../IPositronNotebookInstance.js';
import { bindCellContextKeys, resetCellContextKeys } from '../ContextKeysManager.js';
import { IScopedContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';

/**
 * Custom hook that manages context keys for a notebook cell.
 *
 * This hook handles the binding, updating, and cleanup of context keys
 * that are used by the command system to determine which actions are
 * available for a given cell based on its state.
 *
 * @param cell - The notebook cell instance
 * @param cellElement - The DOM element representing the cell
 * @param notebookInstance - The notebook instance containing all cells
 * @returns The scoped context key service for this cell, or undefined if cellElement is not available
 */
export function useCellContextKeys(
	cell: IPositronNotebookCell,
	cellElement: HTMLDivElement | null,
	notebookInstance: IPositronNotebookInstance
): IScopedContextKeyService | undefined {
	const [contextKeyService, setContextKeyService] = React.useState<IScopedContextKeyService | undefined>(undefined);

	React.useEffect(() => {
		if (!cellElement ||
			!notebookInstance.scopedContextKeyService) {
			setContextKeyService(undefined);
			return;
		}

		const disposables = new DisposableStore();

		// Create a scoped context key service for this cell
		const scopedContextKeyService = notebookInstance.scopedContextKeyService.createScoped(cellElement);
		disposables.add(scopedContextKeyService);

		// Bind the cell-specific context keys
		const keys = bindCellContextKeys(scopedContextKeyService);

		// Keep context keys in sync with cell state
		disposables.add(autorun(reader => {
			if (!keys) {
				return;
			}

			if (!cell || cell.index === -1) {
				resetCellContextKeys(keys);
				return;
			}

			// Subscribe to observables neccesary to update context keys
			const executionStatus = cell.executionStatus.read(reader);
			const selectionStatus = cell.selectionStatus.read(reader);
			const cells = notebookInstance.cells.read(reader);

			const cellType = cell.kind;
			keys.isCode.set(cellType === CellKind.Code);
			keys.isMarkdown.set(cellType === CellKind.Markup);
			keys.isRunning.set(executionStatus === 'running');
			keys.isPending.set(executionStatus === 'pending');
			keys.isFirst.set(cell.index === 0);
			keys.isLast.set(cells.indexOf(cell) === cells.length - 1);
			keys.isOnly.set(cells.length === 1);
			keys.markdownEditorOpen.set(cell.isMarkdownCell() ? cell.editorShown.read(reader) : false);
			keys.isSelected.set(selectionStatus === CellSelectionStatus.Selected);
			keys.isEditing.set(selectionStatus === CellSelectionStatus.Editing);
			keys.canMoveUp.set(cell.index > 0 && cells.length > 1);
			keys.canMoveDown.set(cell.index < cells.length - 1 && cells.length > 1);
		}));

		// Set the state to let other components know that the context keys are ready
		setContextKeyService(scopedContextKeyService);

		return () => {
			resetCellContextKeys(keys);
			disposables.dispose();
			setContextKeyService(undefined);
		};
	}, [cell, cellElement, notebookInstance, notebookInstance.scopedContextKeyService]);

	return contextKeyService;
}
