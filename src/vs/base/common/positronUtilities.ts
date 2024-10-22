/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Types.
type Value = string | number | undefined;
type Mapping = Record<string, unknown>;
type Argument = Value | Mapping;

/**
 * Ensures that a given value is within a range of values.
 * @param value The value.
 * @param minimumValue The minimum value, inclusive.
 * @param maximumValue The maximum value, inclusive.
 * @returns The pinned value.
 */
export const pinToRange = (value: number, minimumValue: number, maximumValue: number) =>
	Math.min(Math.max(value, minimumValue), maximumValue);

/**
 * optionalValue function. Returns the value, if it is not undefined; otherwise, returns the default value.
 * @param value The optional value.
 * @param defaultValue The default value.
 * @returns The value, if it is not undefined; otherwise, the default value.
 */
export const optionalValue = (value: number | string | undefined, defaultValue: number | string) => {
	return value !== undefined ? value : defaultValue;
};

/**
 * optionalBoolean function. Returns the value, if it is not undefined; otherwise, returns false.
 * @param value The optional value.
 * @returns The value, if it is not undefined; otherwise, false.
 */
export const optionalBoolean = (value: boolean | undefined) => {
	return value !== undefined && value;
};

/**
 * positronClassNames function.
 * @param args The arguments.
 * @returns The class names.
 */
export const positronClassNames = (...args: Argument[]) => {
	const classes: string[] = [];

	args.forEach(arg => {
		if (arg !== undefined) {
			if (typeof arg === 'string') {
				classes.push(arg);
			} else if (typeof arg === 'number') {
				classes.push(arg.toString());
			} else {
				for (const key in arg) {
					if (arg.hasOwnProperty(key) && arg[key]) {
						classes.push(key);
					}
				}
			}
		}
	});

	return classes.join(' ');
};
