/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { isStringArray } from '../../../../base/common/types.js';

/**
 * Range interface.
 */
export interface Range {
	readonly min: number;
	readonly max: number;
}

/**
 * Determines whether an array of numbers is contiguous.
 * @param array The array of numbers.
 * @returns true if the array is contiguous; otherwise, false.
 */
export const isContiguous = (array: number[]) => {
	if (array.length === 0) {
		return false;
	}

	if (array.length === 1) {
		return true;
	}

	for (let i = 1; i < array.length; i++) {
		if (array[i - 1] + 1 !== array[i]) {
			return false;
		}
	}

	return true;
};

/**
 * Parses an untyped variable_path value into a validated string array.
 * Returns undefined if the value is not an array of strings.
 */
export function parseVariablePath(raw: unknown): string[] | undefined {
	return isStringArray(raw) ? raw : undefined;
}
