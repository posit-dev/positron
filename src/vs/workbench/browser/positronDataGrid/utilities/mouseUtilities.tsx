/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import { MouseEvent } from 'react';

// Other dependencies.
import { isMacintosh } from 'vs/base/common/platform';
import { MouseSelectionType } from 'vs/workbench/browser/positronDataGrid/classes/dataGridInstance';

/**
 * Maps MouseEvent keys to a MouseSelectionType.
 * @param e The MouseEvent.
 * @returns The MouseSelectionType.
 */
export const selectionType = (e: MouseEvent): MouseSelectionType => {
	// Shift (for range) has a higher priority than the meta / ctrl key (for multiple).
	if (e.shiftKey) {
		return MouseSelectionType.Range;
	} else if (isMacintosh ? e.metaKey : e.ctrlKey) {
		return MouseSelectionType.Multi;
	} else {
		return MouseSelectionType.Single;
	}
};
