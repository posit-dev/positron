/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Matches a top-level (unindented) `name = ...` (Python) or `name <- ...` (R) assignment -- the
// pattern every built-in driver's generateConnectionCode uses to bind the connection, board, or
// engine it creates. Indented lines (e.g. keyword arguments inside a multi-line call) don't
// match, since \w excludes the leading whitespace.
const CONNECTION_VARIABLE_PATTERN = /^(?<variableName>\w+)\s*(?:=|<-)\s*\S/gm;

/**
 * Parses the name of the variable a generated connection code snippet binds. Takes the last
 * top-level assignment rather than the first: built-in drivers only ever emit one, but a driver
 * is free to emit a preparatory statement (e.g. a config variable) before the real bind line, and
 * the bind is always the final top-level assignment in the snippet.
 *
 * Parsed rather than assumed because the snippet the user runs is not always the snippet the
 * driver generated -- the Connect With dialog lets them edit it first, including renaming the
 * variable.
 * @param code The generated connection code.
 */
export function extractConnectionVariableName(code: string): string | undefined {
	let variableName: string | undefined;
	for (const match of code.matchAll(CONNECTION_VARIABLE_PATTERN)) {
		variableName = match.groups?.variableName;
	}
	return variableName;
}

/**
 * Renames the variable a connection code snippet binds, so that connecting to a second database in
 * one session does not overwrite the first.
 *
 * Every driver binds a fixed name for a given language -- `con` in R, `conn` or `engine` in Python
 * -- because it generates the snippet knowing nothing about the session it will run in. Two
 * connections then land on one name, and the second silently replaces the first: the user loses a
 * connection they were using, and any code written against the name now talks to the wrong
 * database.
 *
 * Renamed before the snippet is shown rather than after it runs, so what the user reads in the
 * Connect With dialog is what will actually be bound -- and so that they can override the choice,
 * the snippet being editable.
 *
 * The first free name wins, and the driver's own name is tried first, so the ordinary case of one
 * connection per session is left exactly as the driver wrote it.
 *
 * @param code The generated connection code.
 * @param taken The variable names already in use in the target session.
 * @returns The code with a free name bound, and the name it binds. The code is returned unchanged
 *   when no assignment could be found in it, in which case there is no name to report either.
 */
export function bindConnectionToFreeVariable(
	code: string,
	taken: readonly string[],
): { readonly code: string; readonly variableName: string | undefined } {
	const variableName = extractConnectionVariableName(code);
	if (!variableName || !taken.includes(variableName)) {
		return { code, variableName };
	}

	// Suffixed rather than named after the connection: a connection's name is the user's own free
	// text, and sanitizing it into an identifier produces something long, occasionally unreadable,
	// and still not guaranteed unique. A number says "the second one" and cannot fail.
	let suffix = 2;
	let candidate = `${variableName}_${suffix}`;
	while (taken.includes(candidate)) {
		suffix += 1;
		candidate = `${variableName}_${suffix}`;
	}

	// Every occurrence, not just the assignment: a driver is free to refer back to the connection
	// it made -- to set an option on it, say -- and renaming only the binding would break that.
	// Bounded by word edges so a name that is a prefix of another identifier is left alone.
	const renamed = code.replace(
		new RegExp(`\\b${escapeRegExp(variableName)}\\b`, 'g'),
		candidate,
	);
	return { code: renamed, variableName: candidate };
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
