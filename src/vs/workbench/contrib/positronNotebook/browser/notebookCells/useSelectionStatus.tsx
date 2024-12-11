/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { CellSelectionStatus, IPositronNotebookCell } from '../../../../services/positronNotebook/browser/IPositronNotebookCell.js';
import { SelectionState } from '../../../../services/positronNotebook/browser/selectionMachine.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';

/**
 * Hook to get selection status of a given cell.
 * @param cell Cell who's selection status is to be observed.
 * @returns The current selection status of the cell.
 */
export function useSelectionStatus(cell: IPositronNotebookCell): CellSelectionStatus {
	const notebookInstance = useNotebookInstance();

	const [selectionStatus, setSelectionStatus] = React.useState<CellSelectionStatus>(CellSelectionStatus.Unselected);

	React.useEffect(() => {
		const selectionMachine = notebookInstance.selectionStateMachine;
		const observer = selectionMachine.onNewState((state) => {
			if (state.type === SelectionState.EditingSelection) {
				setSelectionStatus(state.selectedCell === cell ? CellSelectionStatus.Editing : CellSelectionStatus.Unselected);
			} else if (state.type === SelectionState.NoSelection) {
				setSelectionStatus(CellSelectionStatus.Unselected);
			} else {
				setSelectionStatus(state.selected.includes(cell) ? CellSelectionStatus.Selected : CellSelectionStatus.Unselected);
			}
		});

		return observer.dispose;
	}, [notebookInstance, cell]);

	return selectionStatus;
}
