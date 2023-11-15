/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { VariableItem } from 'vs/workbench/services/positronVariables/common/classes/variableItem';

/**
 * Sorts an array of variable items by name.
 * @param variableItems The array of variable items to sort.
 */
export const sortVariableItemsByName = (
	variableItems: VariableItem[]
) => {
	// Sort the variable items by name. Break ties by sorting by size.
	variableItems.sort((a, b) => {
		// Compare the name.
		const result = a.displayName.localeCompare(b.displayName, undefined, { numeric: true });
		if (result !== 0) {
			return result;
		}

		// Break ties by sorting by size;
		if (a.size < b.size) {
			return -1;
		} else if (a.size > b.size) {
			return 1;
		} else {
			return 0;
		}
	});
};

/**
 * Sorts an array of variable items by size.
 * @param variableItems The array of variable items to sort.
 */
export const sortVariableItemsBySize = (
	variableItems: VariableItem[]
) => {
	// Sort the variable items by size. Break ties by sorting by name.
	variableItems.sort((a, b) => {
		// Break ties by sorting by size;
		if (a.size > b.size) {
			return -1;
		} else if (a.size < b.size) {
			return 1;
		} else {
			return a.displayName.localeCompare(b.displayName, undefined, { numeric: true });
		}
	});
};
