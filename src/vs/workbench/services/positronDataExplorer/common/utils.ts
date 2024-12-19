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
 * Performs a linear conversion from one range to another range.
 * @param value The value to convert.
 * @param from The from range.
 * @param to The to range.
 * @returns The converted value.
 */
export const linearConversion = (value: number, from: Range, to: Range) =>
	((value - from.min) / (from.max - from.min)) * (to.max - to.min) + to.min;
