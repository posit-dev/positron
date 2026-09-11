/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The name used when a file name yields nothing usable, e.g. '2020.csv' or '.csv'.
 */
export const DEFAULT_VARIABLE_NAME = 'dataset';

/**
 * Derives a default target variable name from a file name, e.g. 'flights.csv' becomes 'flights' and
 * 'my data-2020.csv' becomes 'my_data_2020'.
 *
 * The result is always a usable identifier, which is what lets the dialog do without validating the
 * name at all: a default that is guaranteed to run means a name that does not run is one the user
 * typed themselves. Two rules cover every language Positron offers an importer for. Characters are
 * restricted to ASCII, since an ASCII letter followed by letters, digits and underscores is a valid
 * identifier in R and Python alike -- the Unicode rules diverge (Python normalizes
 * identifiers to NFKC and rejects a few \p{L} characters R accepts), and the divergence is not worth
 * the reach given the names it would buy. Reserved words are the one part no character rule can
 * cover, so the importer supplies its own list.
 *
 * @param fileName The file name, with extension.
 * @param reservedNames Words the importer's language will not let you assign to.
 * @returns A variable name that can be assigned to in the importer's language.
 */
export function deriveVariableName(fileName: string, reservedNames?: readonly string[]): string {
	// Everything up to the first ASCII letter goes, which drops a leading digit rather than
	// prefixing it: '2020.csv' is named 'dataset', trading the file name for one
	// less rule. Anything left is then ASCII-sanitized, runs of rejected characters collapsing to a
	// single underscore so 'a...b.csv' derives 'a_b' rather than 'a___b'.
	const withoutExtension = fileName.replace(/\.[^.]*$/, '');
	const fromFirstLetter = withoutExtension.replace(/^[^A-Za-z]*/, '');
	let name = fromFirstLetter.length === 0
		? DEFAULT_VARIABLE_NAME
		: fromFirstLetter.replace(/[^A-Za-z0-9]+/g, '_');

	// A reserved word is suffixed rather than prefixed, so the name still reads as the file it came
	// from: 'class.csv' derives 'class_'. The loop covers a language whose reserved list holds both
	// a word and that word plus an underscore; it terminates because the list is finite.
	while (reservedNames?.includes(name)) {
		name = `${name}_`;
	}
	return name;
}
