/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useNotebookInstance } from '../../NotebookInstanceProvider.js';
import { IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { useObservedValue } from '../../useObservedValue.js';
import { CellActionPosition, INotebookCellActionBarItem, NotebookCellActionBarRegistry } from './actionBarRegistry.js';
import { createCellInfo } from './cellConditions.js';

/**
 * Hook to get the all appropriate actions for a cell.
 * @param cell The cell to get the actions for.
 * @returns A record of the actions for each position.
 */
export function useActionsForCell(cell: IPositronNotebookCell): Record<CellActionPosition, INotebookCellActionBarItem[]> {
	const registry = NotebookCellActionBarRegistry.getInstance();
	const instance = useNotebookInstance();
	const cells = instance.cells.get();
	const cellInfo = createCellInfo(cell, cells.length);

	const forCellFilter = (action: INotebookCellActionBarItem) => {
		return !action.cellCondition || action.cellCondition(cellInfo);
	};

	const allLeftActions = useObservedValue(registry.leftActions) ?? [];
	const leftActions = allLeftActions.filter(forCellFilter);
	const allMainActions = useObservedValue(registry.mainActions) ?? [];
	const mainActions = allMainActions.filter(forCellFilter);
	const allMainRightActions = useObservedValue(registry.mainRightActions) ?? [];
	const mainRightActions = allMainRightActions.filter(forCellFilter);
	const allMenuActions = useObservedValue(registry.menuActions) ?? [];
	const menuActions = allMenuActions.filter(forCellFilter);
	return {
		left: leftActions,
		main: mainActions,
		mainRight: mainRightActions,
		menu: menuActions
	};
}
