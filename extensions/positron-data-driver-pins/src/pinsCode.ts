/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDuckDBTableCodeGenerator } from 'positron-data-explorer-duckdb';

/** The Convert-to-Code syntax names offered for a previewed pin. */
const R_SYNTAX = 'R';
const PYTHON_SYNTAX = 'Python';

/**
 * Escapes a value for embedding in a double-quoted Python or R string literal. Both languages treat
 * backslash as an escape character in double-quoted strings, so values containing backslashes or
 * quotes must be escaped.
 */
export function escapeDoubleQuoted(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Identifies a pin version for `pin_read` code generation. */
export interface PinReadTarget {
	/** The normalized Connect server URL. */
	serverUrl: string;
	/** The full pin name, `owner/name`. */
	fullName: string;
	/** The bundle id to read as an explicit version; omitted to read the latest (active) version. */
	version?: string;
}

/**
 * Builds a Data Explorer Convert-to-Code generator that emits `pins` code reading the previewed pin.
 * Both R and Python are offered (the user picks in the Convert-to-Code dialog), matching the
 * driver's connection-level code generation; R is the default. This replaces the DuckDB backend's
 * default SQL output, which would otherwise reference the throwaway in-memory table the preview
 * loads the downloaded file into, code the user could not run.
 */
export function createPinReadCodeGenerator(target: PinReadTarget): IDuckDBTableCodeGenerator {
	return {
		syntaxNames: [R_SYNTAX, PYTHON_SYNTAX],
		defaultSyntaxName: R_SYNTAX,
		generate(syntaxName: string): string[] {
			return syntaxName === PYTHON_SYNTAX ? generatePython(target) : generateR(target);
		},
	};
}

/** Generates the R `pin_read` snippet: connect to the board, then read the pin (by version if given). */
function generateR(target: PinReadTarget): string[] {
	const args = ['board', `"${escapeDoubleQuoted(target.fullName)}"`];
	if (target.version) {
		args.push(`version = "${escapeDoubleQuoted(target.version)}"`);
	}
	return [
		'library(pins)',
		`board <- board_connect(server = "${escapeDoubleQuoted(target.serverUrl)}")`,
		`pin_read(${args.join(', ')})`,
	];
}

/** Generates the Python `pin_read` snippet, mirroring {@link generateR}. */
function generatePython(target: PinReadTarget): string[] {
	const args = [`"${escapeDoubleQuoted(target.fullName)}"`];
	if (target.version) {
		args.push(`version="${escapeDoubleQuoted(target.version)}"`);
	}
	return [
		'import pins',
		`board = pins.board_connect(server_url="${escapeDoubleQuoted(target.serverUrl)}")`,
		`board.pin_read(${args.join(', ')})`,
	];
}
