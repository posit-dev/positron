/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { IPositronNotebookCodeCell } from '../PositronNotebookCells/IPositronNotebookCell.js';

/**
 * React context providing the current notebook code cell to its descendants.
 */
export const CellContext = React.createContext<IPositronNotebookCodeCell | undefined>(undefined);

/**
 * Provider component to make a code cell available to its descendants via {@link useCell}.
 *
 * @param props.cell - The code cell for this subtree
 * @param props.children - React children that need access to the cell
 */
export function CellProvider({ cell, children }: { cell: IPositronNotebookCodeCell; children: React.ReactNode }) {
	return <CellContext.Provider value={cell}>{children}</CellContext.Provider>;
}

/**
 * Hook to consume the current cell from React context.
 *
 * @returns The current code cell, or `undefined` when not wrapped in a {@link CellProvider}.
 */
export function useCell(): IPositronNotebookCodeCell | undefined {
	return React.useContext(CellContext);
}
