/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// All this will move to positron-python in the future.

/**
 * The shape of a usable target variable name: a letter or underscore, then letters, digits, or
 * underscores. This is the Python rule, which is also the strictest of the two languages Import
 * Data will offer first. The next PR will move the rule behind the registry, because R has
 * different rules.
 */
const VARIABLE_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Python's reserved keywords. A keyword matches the identifier shape but cannot be assigned to, so
 * 'class = pd.read_csv(...)' is a SyntaxError. The soft keywords ('match', 'case', 'type', '_') are
 * deliberately absent, because they are valid identifiers. This list must stay in step with the one
 * in `extensions/positron-python/src/client/positron/dataImport/pandasCodeGenerator.ts` until the
 * next PR makes the registry the single source of the rule.
 */
const PYTHON_KEYWORDS = new Set([
	'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
	'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import',
	'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while',
	'with', 'yield',
]);

/**
 * Derives a default target variable name from a file name, e.g. 'flights.csv' becomes 'flights'.
 * The result always satisfies {@link isValidVariableName}, so the dialog opens in a valid state
 * whatever the file is called.
 * @param fileName The file name, with extension.
 * @returns A valid variable name.
 */
export function deriveVariableName(fileName: string): string {
	const withoutExtension = fileName.replace(/\.[^.]*$/, '');
	const sanitized = withoutExtension.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
	if (sanitized.length === 0) {
		return 'data';
	}
	// A name cannot start with a digit, so '2020 data.csv' becomes '_2020_data' rather than an
	// expression that will not parse.
	if (/^[0-9]/.test(sanitized)) {
		return `_${sanitized}`;
	}
	// A keyword is suffixed rather than prefixed, so the name still reads as the file it came from.
	// This matches what the pandas generator does, so 'class.csv' derives 'class_' either way.
	return PYTHON_KEYWORDS.has(sanitized) ? `${sanitized}_` : sanitized;
}

/**
 * Whether a name can be assigned to in the generated code. A keyword is rejected as well as a
 * malformed identifier, so a user who types 'class' sees Import disabled rather than a
 * SyntaxError in the console.
 * @param name The name the user typed.
 * @returns true if the name is a usable identifier.
 */
export function isValidVariableName(name: string): boolean {
	return VARIABLE_NAME_REGEX.test(name) && !PYTHON_KEYWORDS.has(name);
}
