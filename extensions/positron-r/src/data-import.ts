/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

/** A request to generate a readr load statement. */
export interface ReadrImportRequest {
	/** The absolute path of the file to load. */
	filePath: string;

	/** The target variable name. */
	variableName: string;

	/** Whether the first row holds column names. Treated as true when absent. */
	hasHeaderRow?: boolean;
}

/**
 * Escapes a string so it can be embedded in a double-quoted, single-line R literal. Windows paths
 * are the reason this exists: an unescaped backslash before an 'n' or a 't' silently changes the
 * path. Control characters are escaped too, because a POSIX file name may legally contain a
 * newline, which would otherwise terminate the generated literal.
 */
export function escapeRString(value: string): string {
	return value.replace(/[\\"\u0000-\u001f\u007f]/g, (character) => {
		switch (character) {
			case '\\':
				return '\\\\';
			case '"':
				return '\\"';
			case '\n':
				return '\\n';
			case '\r':
				return '\\r';
			case '\t':
				return '\\t';
			default: {
				const code = character.charCodeAt(0).toString(16).padStart(2, '0');
				return `\\x${code}`;
			}
		}
	});
}

/**
 * R's reserved words, which cannot be assigned to: 'if <- read_csv(...)' is a parse error and
 * 'TRUE <- read_csv(...)' is an invalid left-hand side. `T` and `F` are absent because they are
 * ordinary (if ill-advised) variables.
 *
 * This is R's full list rather than only the words Positron can derive from a file name. The dotted
 * entries are unreachable today, since a derived name is ASCII letters, digits and underscores, but
 * a complete list is easier to check against the language definition than a filtered one.
 */
export const R_RESERVED_NAMES = [
	'if', 'else', 'repeat', 'while', 'function', 'for', 'next', 'break', 'in',
	'TRUE', 'FALSE', 'NULL', 'Inf', 'NaN', 'NA',
	'NA_integer_', 'NA_real_', 'NA_complex_', 'NA_character_',
	'...',
];

/** Whether a path names a tab-separated file, which readr has a dedicated reader for. */
function isTabSeparated(filePath: string): boolean {
	return filePath.toLowerCase().endsWith('.tsv');
}

/**
 * Generates the readr code that loads a file into a data frame.
 *
 * The comment sits directly above the call rather than above library(), so it labels the thing it
 * describes, and it names the variable so a script that accumulates several imports stays
 * readable.
 */
export function generateReadrImportCode(request: ReadrImportRequest): string {
	const args = [`"${escapeRString(request.filePath)}"`];
	if (request.hasHeaderRow === false) {
		args.push('col_names = FALSE');
	}
	const readFunction = isTabSeparated(request.filePath) ? 'read_tsv' : 'read_csv';

	return [
		'library(readr)',
		'',
		`# Load ${request.variableName} data`,
		`${request.variableName} <- ${readFunction}(${args.join(', ')})`,
		'',
	].join('\n');
}

/**
 * Registers the readr data importer, which generates the code that loads a delimited file into a
 * data frame. Generation is pure TypeScript; no R runtime is involved.
 */
export function registerRDataImporter(context: vscode.ExtensionContext): void {
	context.subscriptions.push(positron.dataExplorer.registerDataImporter({
		languageId: 'r',
		displayName: 'R (readr)',
		fileExtensions: ['csv', 'tsv'],
		reservedNames: R_RESERVED_NAMES,
		generateCode: (request: positron.DataImportRequest): positron.DataImportResult => ({
			code: generateReadrImportCode({
				filePath: request.fileUri.fsPath,
				variableName: request.variableName,
				hasHeaderRow: request.options.hasHeaderRow,
			}),
		}),
	}));
}
