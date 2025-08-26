/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CellSelectionStatus } from '../../../../../services/positronNotebook/browser/IPositronNotebookCell.js';

/**
 * Hook to determine if the action bar should be visible based on cell state.
 * Centralizes visibility logic for better maintainability and testing.
 */
export function useActionBarVisibility(
	isHovered: boolean,
	isMenuOpen: boolean,
	selectionStatus: CellSelectionStatus
): boolean {
	return isMenuOpen || isHovered ||
		selectionStatus === CellSelectionStatus.Selected ||
		selectionStatus === CellSelectionStatus.Editing;
}