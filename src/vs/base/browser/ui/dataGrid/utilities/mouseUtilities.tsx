/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import { MouseEvent } from 'react';
import { MouseSelectionType } from 'vs/base/browser/ui/dataGrid/interfaces/dataGridInstance';

// Other dependencies.
import { isMacintosh } from 'vs/base/common/platform';

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
