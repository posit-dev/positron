/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { EnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/classes/environmentVariableItem';

/**
 * Sorts an array of environment variable items by name.
 * @param items The array of environment variable items to sort.
 */
export const sortEnvironmentVariableItemsByName = (items: EnvironmentVariableItem[]) => {
	// Sort the environment variable items by name. Break ties by sorting by size.
	// largest.
	items.sort((a, b) => {
		// Compare the name.
		const result = a.name.localeCompare(b.name, undefined, { numeric: true });
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
 * Sorts an array of environment variable items by size.
 * @param items The array of environment variable items to sort.
 */
export const sortEnvironmentVariableItemsBySize = (items: EnvironmentVariableItem[]) => {
	// Sort the environment variable items by size. Break ties by sorting by name.
	items.sort((a, b) => {
		// Break ties by sorting by size;
		if (a.size < b.size) {
			return -1;
		} else if (a.size > b.size) {
			return 1;
		} else {
			return a.name.localeCompare(b.name, undefined, { numeric: true });
		}
	});
};
