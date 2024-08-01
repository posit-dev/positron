/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Creates an array from an index range.
 * @param startIndex The start index.
 * @param endIndex The end index.
 * @returns An array with the specified index range.
 */
export const arrayFromIndexRange = (startIndex: number, endIndex: number) =>
	Array.from({ length: endIndex - startIndex + 1 }, (_, i) => startIndex + i);

/**
 * Asychronously delays execution.
 * @param ms The number of milliseconds to delay.
 * @returns A Promise<void> that resolves when the delay is complete.
 */
export const asyncDelay = (ms: number) => {
	return new Promise(resolve => setTimeout(resolve, ms));
};
