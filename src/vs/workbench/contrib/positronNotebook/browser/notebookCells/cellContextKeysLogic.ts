/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure helpers for cell-position context-key formulas computed in
 * {@link useCellContextKeys}. Extracted so the boundary logic can be unit
 * tested directly without standing up a React hook + autorun + scoped
 * context key service.
 *
 * The `&& totalCells > 1` guard handles the single-cell case where the
 * "move" actions are conceptually meaningless even though the index check
 * alone might suggest otherwise (a 1-cell notebook has nothing to move).
 */

export function canMoveUp(cellIndex: number, totalCells: number): boolean {
	return cellIndex > 0 && totalCells > 1;
}

export function canMoveDown(cellIndex: number, totalCells: number): boolean {
	return cellIndex < totalCells - 1 && totalCells > 1;
}
