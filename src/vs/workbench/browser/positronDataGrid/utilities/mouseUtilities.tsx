/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { MouseEvent } from 'react';

// Other dependencies.
import { isMacintosh } from '../../../../base/common/platform.js';
import { MouseSelectionType } from '../classes/dataGridInstance.js';

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
