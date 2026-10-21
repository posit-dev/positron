/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { IPositronNotebookCell, IPositronNotebookCodeCell } from '../PositronNotebookCells/IPositronNotebookCell.js';

/**
 * React context providing the current notebook cell to its descendants.
 */
const CellContext = React.createContext<IPositronNotebookCell | undefined>(undefined);

/**
 * Provider component to make a cell available to its descendants via {@link useCell}.
 */
export function CellProvider({ cell, children }: { cell: IPositronNotebookCell; children: React.ReactNode }) {
	return <CellContext.Provider value={cell}>{children}</CellContext.Provider>;
}

/**
 * Hook to consume the current cell from React context.
 *
 * @returns The current cell. Throws if not wrapped in a {@link CellProvider}.
 */
export function useCell(): IPositronNotebookCell {
	const cell = React.useContext(CellContext);
	if (!cell) {
		throw new Error('useCell must be used within a CellProvider');
	}
	return cell;
}

/**
 * Hook to consume the current cell narrowed to a code cell.
 *
 * @returns The current code cell. Throws if the cell is not a code cell.
 */
export function useCodeCell(): IPositronNotebookCodeCell {
	const cell = useCell();
	if (!cell.isCodeCell()) {
		throw new Error('useCodeCell must be used within a code cell');
	}
	return cell;
}
