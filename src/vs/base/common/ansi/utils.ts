/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Rounds a number to a specified number of decimal points.
 * @param number The number to round.
 * @param decimalPoints The number of decimal points to round to.
 * @returns The rounded number.
 */
const roundNumber = (number: number, decimalPoints: number): number => {
	const decimal = Math.pow(10, decimalPoints);
	return Math.round(number * decimal) / decimal;
};
