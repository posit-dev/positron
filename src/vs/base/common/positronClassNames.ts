/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

type Value = string | number | undefined;
type Mapping = Record<string, unknown>;
type Argument = Value | Mapping;

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
