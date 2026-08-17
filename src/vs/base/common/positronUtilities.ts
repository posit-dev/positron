/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from './uri.js';

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

/**
 * Serializes a URI for navigation to an external address, preserving query
 * string delimiters.
 *
 * @param uri The URI to serialize.
 * @returns The serialized URI, or `URI.toString()` when it cannot be parsed.
 */
export function externalUriToString(uri: URI): string {
	try {
		// `toString(true)` leaves the query untouched; the `URL` parser then
		// re-encodes each component under the correct rules for its position.
		return new URL(uri.toString(true)).toString();
	} catch {
		return uri.toString();
	}
}
