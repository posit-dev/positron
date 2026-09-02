/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

/** A request to generate a readr load statement. */
export interface ReadrImportRequest {
	/**
	 * The path of the file to load as a ready-to-embed string literal, already quoted and escaped
	 * (the output of positron.paths.formatPathForCode): workspace-relative when the file is inside
	 * the workspace, absolute otherwise.
	 */
	pathLiteral: string;

	/** The target variable name. */
	variableName: string;

	/** Whether the first row holds column names. Treated as true when absent. */
	hasHeaderRow?: boolean;

	/** The Data Explorer view (filters and sorts) to reproduce after the load, if requested. */
	view?: positron.DataImportView;
}

/** The generated code plus anything in the view it does not reproduce. */
export interface ReadrImportResult {
	code: string;
	unsupported: string[];
}

/**
 * Escapes a string so it can be embedded in a double-quoted, single-line R literal. Filter terms
 * and column values are arbitrary text: an unescaped backslash before an 'n' or a 't' silently
 * changes the value, and an unescaped control character would terminate or corrupt the generated
 * literal.
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

/**
 * Whether a quoted path literal names a tab-separated file, which readr has a dedicated reader
 * for. The literal's closing quote is part of the match, so the check cannot be fooled by a
 * directory named `x.tsv` in the middle of the path.
 */
function isTabSeparated(pathLiteral: string): boolean {
	return /\.tsv"$/i.test(pathLiteral);
}

/**
 * R names that need no backticks: a letter, or a dot not followed by a digit, then letters, digits,
 * dots and underscores. A name like `.2foo` is not syntactic and has to be backticked.
 */
const SYNTACTIC_R_NAME = /^(?:[a-zA-Z]|\.(?![0-9]))[a-zA-Z0-9._]*$/;

/** Renders a column reference, backticked when the name is not syntactic (or is reserved). */
function rColumn(columnName: string): string {
	if (SYNTACTIC_R_NAME.test(columnName) && !R_RESERVED_NAMES.includes(columnName)) {
		return columnName;
	}
	return '`' + columnName.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`';
}

/** Display types whose stringified values are emitted as bare numeric literals. */
const NUMERIC_COLUMN_TYPES = new Set(['integer', 'floating', 'decimal']);

const NUMERIC_LITERAL = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Renders a stringified Data Explorer value as an R literal matching the column's type, or
 * undefined when it cannot be one (which routes the whole filter to `unsupported`).
 */
function rLiteral(value: string, columnType: string): string | undefined {
	const trimmed = value.trim();
	if (NUMERIC_COLUMN_TYPES.has(columnType)) {
		return NUMERIC_LITERAL.test(trimmed) ? trimmed : undefined;
	}
	if (columnType === 'boolean') {
		if (/^true$/i.test(trimmed)) {
			return 'TRUE';
		}
		if (/^false$/i.test(trimmed)) {
			return 'FALSE';
		}
		return undefined;
	}
	if (columnType === 'string') {
		return `"${escapeRString(value)}"`;
	}
	return undefined;
}

function rSearchTerm(column: string, filter: positron.DataImportSearchFilter): string {
	switch (filter.searchType) {
		case 'contains':
		case 'not_contains': {
			// fixed = TRUE is a literal, case-sensitive match; the insensitive variant lowers
			// both sides rather than treating the term as a regex with ignore.case.
			const match = filter.caseSensitive
				? `grepl("${escapeRString(filter.term)}", ${column}, fixed = TRUE)`
				: `grepl("${escapeRString(filter.term.toLowerCase())}", tolower(${column}), fixed = TRUE)`;
			if (filter.searchType === 'contains') {
				return match;
			}
			// grepl() reports FALSE for NA, so the bare negation would keep null rows, while the
			// backend's `NOT LIKE` yields NULL for them and drops the row.
			return `(!is.na(${column}) & !${match})`;
		}
		case 'starts_with':
		case 'ends_with': {
			const fn = filter.searchType === 'starts_with' ? 'startsWith' : 'endsWith';
			const target = filter.caseSensitive ? column : `tolower(${column})`;
			const term = filter.caseSensitive ? filter.term : filter.term.toLowerCase();
			return `${fn}(${target}, "${escapeRString(term)}")`;
		}
		case 'regex_match': {
			const ignoreCase = filter.caseSensitive ? '' : ', ignore.case = TRUE';
			return `grepl("${escapeRString(filter.term)}", ${column}${ignoreCase})`;
		}
	}
}

/** Translates one row filter into a dplyr::filter() term. Undefined means untranslatable. */
function rFilterTerm(filter: positron.DataImportRowFilter): string | undefined {
	const column = rColumn(filter.columnName);
	switch (filter.filterType) {
		case 'is_null':
			return `is.na(${column})`;
		case 'not_null':
			return `!is.na(${column})`;
		case 'is_empty':
			return `(${column} == "")`;
		case 'not_empty':
			return `(${column} != "")`;
		case 'is_true':
			return column;
		case 'is_false':
			return `!${column}`;
		case 'compare': {
			const literal = rLiteral(filter.value, filter.columnType);
			if (literal === undefined) {
				return undefined;
			}
			const op = filter.op === '=' ? '==' : filter.op;
			return `${column} ${op} ${literal}`;
		}
		case 'between':
		case 'not_between': {
			const left = rLiteral(filter.leftValue, filter.columnType);
			const right = rLiteral(filter.rightValue, filter.columnType);
			if (left === undefined || right === undefined) {
				return undefined;
			}
			const term = `between(${column}, ${left}, ${right})`;
			return filter.filterType === 'between' ? term : `!${term}`;
		}
		case 'set_membership': {
			const literals = filter.values.map(value => rLiteral(value, filter.columnType));
			if (literals.some(literal => literal === undefined)) {
				return undefined;
			}
			// `%in%` reports FALSE for NA, so the negation would keep null rows the backend's
			// `NOT IN` drops.
			const term = `(${column} %in% c(${literals.join(', ')}))`;
			return filter.inclusive ? term : `(!is.na(${column}) & !${term})`;
		}
		case 'search':
			return rSearchTerm(column, filter);
	}
}

/**
 * Translates the view into piped dplyr verbs applied to the loaded data frame. R's `&` binds
 * tighter than `|`, matching the AND/OR precedence the backend uses on the filter chain, so the
 * terms join in order inside one filter() call.
 *
 * `condition` is always 'and' today, and the DuckDB backend ANDs its row filters unconditionally
 * regardless of `condition`. If the UI ever emits 'or', the `|` join below needs to be re-validated
 * against the backend's actual filtering behavior, or the generated code could silently diverge
 * from the on-screen filtered rows.
 */
function translateView(
	view: positron.DataImportView,
	hasHeaderRow: boolean | undefined,
	unsupported: string[]
): string[] {
	if (hasHeaderRow === false) {
		// A headerless read_csv names columns X1..Xn, so the Data Explorer's column names would
		// not exist in the data frame the generated code operates on.
		unsupported.push('filters and sorts (the file has no header row, so the loaded columns are not named)');
		return [];
	}

	const verbs: string[] = [];

	let condition = '';
	for (const filter of view.rowFilters) {
		const term = rFilterTerm(filter);
		if (term === undefined) {
			unsupported.push(`filter on "${filter.columnName}" (${filter.filterType})`);
			continue;
		}
		condition = condition.length === 0 ? term : `${condition} ${filter.condition === 'or' ? '|' : '&'} ${term}`;
	}
	if (condition.length > 0) {
		verbs.push(`filter(${condition})`);
	}

	if (view.sortKeys.length > 0) {
		const keys = view.sortKeys
			.map(key => key.ascending ? rColumn(key.columnName) : `desc(${rColumn(key.columnName)})`)
			.join(', ');
		verbs.push(`arrange(${keys})`);
	}

	return verbs;
}

/**
 * Generates the readr code that loads a file into a data frame.
 *
 * The comment sits directly above the call rather than above library(), so it labels the thing it
 * describes, and it names the variable so a script that accumulates several imports stays
 * readable.
 */
export function generateReadrImportCode(request: ReadrImportRequest): ReadrImportResult {
	const args = [request.pathLiteral];
	if (request.hasHeaderRow === false) {
		args.push('col_names = FALSE');
	}
	const readFunction = isTabSeparated(request.pathLiteral) ? 'read_tsv' : 'read_csv';

	const unsupported: string[] = [];
	const verbs = request.view ? translateView(request.view, request.hasHeaderRow, unsupported) : [];

	const lines = ['library(readr)'];
	if (verbs.length > 0) {
		lines.push('library(dplyr)');
	}
	lines.push(
		'',
		`# Load ${request.variableName} data`,
		`${request.variableName} <- ${readFunction}(${args.join(', ')})`,
	);
	if (verbs.length > 0) {
		lines.push(
			'',
			'# Filter and sort as shown in the Data Explorer',
			`${request.variableName} <- ${request.variableName} |>`,
			...verbs.map((verb, index) => `  ${verb}${index < verbs.length - 1 ? ' |>' : ''}`),
		);
	}
	lines.push('');

	return { code: lines.join('\n'), unsupported };
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
		generateCode: async (request: positron.DataImportRequest): Promise<positron.DataImportResult> =>
			generateReadrImportCode({
				// Workspace-relative when the file is inside the workspace, so the generated
				// code survives version control and other machines; absolute otherwise.
				pathLiteral: await positron.paths.formatPathForCode(request.fileUri.fsPath, {
					relativeTo: 'workspace',
				}),
				variableName: request.variableName,
				hasHeaderRow: request.options.hasHeaderRow,
				view: request.view,
			}),
	}));
}
