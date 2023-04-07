/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { EnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/classes/environmentVariableItem';

/**
 * Sorts an array of environment variable items by name.
 * @param environmentVariableItems The array of environment variable items to sort.
 */
export const sortEnvironmentVariableItemsByName = (
	environmentVariableItems: EnvironmentVariableItem[]
) => {
	// Sort the environment variable items by name. Break ties by sorting by size.
	// largest.
	environmentVariableItems.sort((a, b) => {
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
 * Sorts an array of environment variable items by size.
 * @param environmentVariableItems The array of environment variable items to sort.
 */
export const sortEnvironmentVariableItemsBySize = (
	environmentVariableItems: EnvironmentVariableItem[]
) => {
	// Sort the environment variable items by size. Break ties by sorting by name.
	environmentVariableItems.sort((a, b) => {
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
