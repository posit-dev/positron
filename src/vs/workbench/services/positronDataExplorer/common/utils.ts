/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Range interface.
 */
export interface Range {
	readonly min: number;
	readonly max: number;
}

/**
 * Creates an array from an index range.
 * @param startIndex The start index.
 * @param endIndex The end index.
 * @returns An array with the specified index range.
 */
export const arrayFromIndexRange = (startIndex: number, endIndex: number) =>
	Array.from({ length: endIndex - startIndex + 1 }, (_, i) => startIndex + i);

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
