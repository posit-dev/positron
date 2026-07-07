/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Throwaway sample used to try out the on-demand PETE test-checker on a real PR.
 * Safe to delete -- this PR is not intended to be merged.
 *
 * Clamps a number into the inclusive range [min, max].
 */
export function clampToRange(value: number, min: number, max: number): number {
	if (min > max) {
		throw new Error(`Invalid range: min (${min}) is greater than max (${max}).`);
	}
	if (value < min) {
		return min;
	}
	if (value > max) {
		return max;
	}
	return value;
}
