/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

// Types.
type Value = string | number | undefined;
type Mapping = Record<string, unknown>;
type Argument = Value | Mapping;

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
