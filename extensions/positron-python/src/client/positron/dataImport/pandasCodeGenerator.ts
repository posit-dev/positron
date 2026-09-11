/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generates the pandas code that loads a data file into a dataframe. Pure module: the `positron`
 * import below is type-only and erased at compile, so no Python runtime and no VS Code or Positron
 * API is involved in generation, which keeps the whole module unit-testable.
 */

// eslint-disable-next-line import/no-unresolved
import type { DataImportRowFilter, DataImportSearchFilter, DataImportView } from 'positron';

/** A request to generate a pandas load statement. */
export interface PandasImportRequest {
    /**
     * The path of the file to load as a ready-to-embed string literal, already quoted and escaped
     * (the output of positron.paths.formatPathForCode): workspace-relative when the file is inside
     * the workspace, absolute otherwise.
     */
    pathLiteral: string;

    /** The target dataframe variable name. */
    variableName: string;

    /** Whether the first row holds column names. Treated as true when absent. */
    hasHeaderRow?: boolean;

    /** The worksheet to read, for formats that have sheets. Omitted means the first sheet. */
    sheetName?: string;

    /** The Data Explorer view (filters and sorts) to reproduce after the load, if requested. */
    view?: DataImportView;
}

/** The generated code plus anything in the view it does not reproduce. */
export interface PandasImportResult {
    code: string;
    unsupported: string[];
}

/**
 * Escapes a string so it can be embedded in a double-quoted, single-line Python literal. Filter
 * terms and column values are arbitrary text: an unescaped backslash before a 'n' or a 't'
 * silently changes the value, and an unescaped control character would terminate or corrupt the
 * generated literal.
 */
export function escapePythonString(value: string): string {
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
 * Python's reserved keywords. A keyword is not a usable identifier, so 'class.csv' must not derive
 * 'class': the generated 'class = pd.read_csv(...)' is a SyntaxError. The soft keywords ('match',
 * 'case', 'type', '_') are deliberately absent, because they are valid identifiers.
 */
export const PYTHON_KEYWORDS = new Set([
    'False',
    'None',
    'True',
    'and',
    'as',
    'assert',
    'async',
    'await',
    'break',
    'class',
    'continue',
    'def',
    'del',
    'elif',
    'else',
    'except',
    'finally',
    'for',
    'from',
    'global',
    'if',
    'import',
    'in',
    'is',
    'lambda',
    'nonlocal',
    'not',
    'or',
    'pass',
    'raise',
    'return',
    'try',
    'while',
    'with',
    'yield',
]);

/** The file formats the generator can write a load call for, keyed off the path's extension. */
type FileFormat = 'csv' | 'tsv' | 'xlsx' | 'parquet';

/**
 * Detects the format from the extension of a quoted path literal. The literal's closing quote is
 * part of each match, so the check cannot be fooled by a directory named `x.tsv` in the middle of
 * the path. An unrecognized extension falls back to CSV, preserving the generator's existing
 * behavior for paths the registry should not have sent it.
 */
function detectFileFormat(pathLiteral: string): FileFormat {
    const lower = pathLiteral.toLowerCase();
    if (lower.endsWith('.tsv"')) {
        return 'tsv';
    }
    if (lower.endsWith('.xlsx"')) {
        return 'xlsx';
    }
    if (lower.endsWith('.parquet"') || lower.endsWith('.parq"')) {
        return 'parquet';
    }
    return 'csv';
}

/** Display types whose stringified values are emitted as bare numeric literals. */
const NUMERIC_COLUMN_TYPES = new Set(['integer', 'floating', 'decimal']);

const NUMERIC_LITERAL = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Drops leading zeros from the integer part. DuckDB accepts '01', but Python reads a leading zero
 * on an integer literal as the start of a base prefix and rejects it, so the value has to be
 * canonicalized before it is emitted. The digit the pattern keeps preserves a bare '0'.
 */
function canonicalNumber(value: string): string {
    return value.replace(/^(-?)0+(\d)/, '$1$2');
}

/**
 * Renders a stringified Data Explorer value as a Python literal matching the column's type, or
 * undefined when it cannot be one (which routes the whole filter to `unsupported`).
 */
function pythonLiteral(value: string, columnType: string): string | undefined {
    const trimmed = value.trim();
    if (NUMERIC_COLUMN_TYPES.has(columnType)) {
        return NUMERIC_LITERAL.test(trimmed) ? canonicalNumber(trimmed) : undefined;
    }
    if (columnType === 'boolean') {
        if (/^true$/i.test(trimmed)) {
            return 'True';
        }
        if (/^false$/i.test(trimmed)) {
            return 'False';
        }
        return undefined;
    }
    if (columnType === 'string') {
        return `"${escapePythonString(value)}"`;
    }
    return undefined;
}

function pandasColumn(dataFrame: string, columnName: string): string {
    return `${dataFrame}["${escapePythonString(columnName)}"]`;
}

function pandasSearchTerm(column: string, filter: DataImportSearchFilter): string {
    switch (filter.searchType) {
        case 'contains':
        case 'not_contains': {
            // A null never matches on either side: the backend's `NOT LIKE` yields NULL for a null
            // column value, dropping the row, so `na` flips with the negation to drop it too.
            const na = filter.searchType === 'contains' ? 'False' : 'True';
            const match = `${column}.str.contains("${escapePythonString(filter.term)}", case=${
                filter.caseSensitive ? 'True' : 'False'
            }, regex=False, na=${na})`;
            return filter.searchType === 'contains' ? match : `~${match}`;
        }
        case 'starts_with':
        case 'ends_with': {
            // str.startswith has no case argument, so a case-insensitive match lowers both sides.
            const method = filter.searchType === 'starts_with' ? 'startswith' : 'endswith';
            const target = filter.caseSensitive ? column : `${column}.str.lower()`;
            const term = filter.caseSensitive ? filter.term : filter.term.toLowerCase();
            return `${target}.str.${method}("${escapePythonString(term)}", na=False)`;
        }
        case 'regex_match':
            return `${column}.str.contains("${escapePythonString(filter.term)}", case=${
                filter.caseSensitive ? 'True' : 'False'
            }, regex=True, na=False)`;
    }
}

/**
 * Translates one row filter into a boolean mask term, parenthesized wherever `&`/`|` precedence
 * could otherwise capture an operand. Undefined means the filter cannot be reproduced.
 */
function pandasFilterTerm(dataFrame: string, filter: DataImportRowFilter): string | undefined {
    const column = pandasColumn(dataFrame, filter.columnName);
    switch (filter.filterType) {
        case 'is_null':
            return `${column}.isna()`;
        case 'not_null':
            return `${column}.notna()`;
        case 'is_empty':
            return `(${column} == "")`;
        case 'not_empty':
            // `NaN != ""` is true in pandas, but the backend's `<> ''` yields NULL for a null and
            // drops the row, so the null check keeps the two in step. Same for the negations below.
            return `(${column}.notna() & (${column} != ""))`;
        case 'is_true':
            // A boolean column with missing values loads as an object or nullable series, where the
            // bare column is not a usable mask and `~` raises. Comparing elementwise and filling the
            // result drops the nulls, which is what the backend's `WHERE col` does too.
            return `${column}.eq(True).fillna(False)`;
        case 'is_false':
            return `${column}.eq(False).fillna(False)`;
        case 'compare': {
            const literal = pythonLiteral(filter.value, filter.columnType);
            if (literal === undefined) {
                return undefined;
            }
            if (filter.op === '!=') {
                // `NaN != value` is true in pandas, but the backend's `<>` yields NULL and drops
                // the row. Every other operator is already false for a null on both sides.
                return `(${column}.notna() & (${column} != ${literal}))`;
            }
            const op = filter.op === '=' ? '==' : filter.op;
            return `(${column} ${op} ${literal})`;
        }
        case 'between':
        case 'not_between': {
            const left = pythonLiteral(filter.leftValue, filter.columnType);
            const right = pythonLiteral(filter.rightValue, filter.columnType);
            if (left === undefined || right === undefined) {
                return undefined;
            }
            const term = `${column}.between(${left}, ${right})`;
            return filter.filterType === 'between' ? term : `(~${term} & ${column}.notna())`;
        }
        case 'set_membership': {
            const literals = filter.values.map((value) => pythonLiteral(value, filter.columnType));
            if (literals.some((literal) => literal === undefined)) {
                return undefined;
            }
            const term = `${column}.isin([${literals.join(', ')}])`;
            return filter.inclusive ? term : `(~${term} & ${column}.notna())`;
        }
        case 'search':
            return pandasSearchTerm(column, filter);
    }
}

/**
 * Translates the view into statements applied to the loaded dataframe. `&` binds tighter than `|`
 * in Python, matching the AND/OR precedence the backend uses to evaluate the filter chain, so the
 * terms join in order without extra grouping.
 *
 * `condition` is always 'and' today, and the DuckDB backend ANDs its row filters unconditionally
 * regardless of `condition`. If the UI ever emits 'or', the '|' join below needs to be re-validated
 * against the backend's actual filtering behavior, or the generated code could silently diverge
 * from the on-screen filtered rows.
 */
function translateView(
    dataFrame: string,
    view: DataImportView,
    hasHeaderRow: boolean | undefined,
    unsupported: string[],
): string[] {
    if (hasHeaderRow === false) {
        // A headerless load names columns 0..n, so the Data Explorer's column names would not
        // exist in the dataframe the generated code operates on.
        unsupported.push('filters and sorts (the file has no header row, so the loaded columns are not named)');
        return [];
    }

    const statements: string[] = [];

    let mask = '';
    for (const filter of view.rowFilters) {
        const term = pandasFilterTerm(dataFrame, filter);
        if (term === undefined) {
            unsupported.push(`filter on "${filter.columnName}" (${filter.filterType})`);
            continue;
        }
        mask = mask.length === 0 ? term : `${mask} ${filter.condition === 'or' ? '|' : '&'} ${term}`;
    }
    if (mask.length > 0) {
        statements.push(`${dataFrame} = ${dataFrame}[${mask}]`);
    }

    if (view.sortKeys.length === 1) {
        const key = view.sortKeys[0];
        const ascending = key.ascending ? '' : ', ascending=False';
        statements.push(`${dataFrame} = ${dataFrame}.sort_values("${escapePythonString(key.columnName)}"${ascending})`);
    } else if (view.sortKeys.length > 1) {
        const names = view.sortKeys.map((key) => `"${escapePythonString(key.columnName)}"`).join(', ');
        const ascending = view.sortKeys.map((key) => (key.ascending ? 'True' : 'False')).join(', ');
        statements.push(`${dataFrame} = ${dataFrame}.sort_values([${names}], ascending=[${ascending}])`);
    }

    return statements;
}

/**
 * Generates the pandas code that loads a file into a dataframe.
 *
 * The comment sits directly above the call rather than above the import, so it labels the thing it
 * describes, and it names the variable so a script that accumulates several imports stays readable.
 */
export function generatePandasImportCode(request: PandasImportRequest): PandasImportResult {
    const format = detectFileFormat(request.pathLiteral);
    const args = [request.pathLiteral];

    let readFunction: string;
    switch (format) {
        case 'parquet':
            // Parquet always carries column names and has no sheets, so the header and
            // sheet options do not apply, whatever the options bag says.
            readFunction = 'read_parquet';
            break;
        case 'xlsx':
            readFunction = 'read_excel';
            if (request.sheetName !== undefined) {
                args.push(`sheet_name="${escapePythonString(request.sheetName)}"`);
            }
            if (request.hasHeaderRow === false) {
                args.push('header=None');
            }
            break;
        case 'tsv':
        case 'csv':
            readFunction = 'read_csv';
            if (format === 'tsv') {
                args.push('sep="\\t"');
            }
            if (request.hasHeaderRow === false) {
                args.push('header=None');
            }
            break;
    }

    const lines = [
        'import pandas as pd',
        '',
        `# Load ${request.variableName} data`,
        `${request.variableName} = pd.${readFunction}(${args.join(', ')})`,
    ];

    const unsupported: string[] = [];
    if (request.view) {
        // Parquet columns are always named, so the headerless-columns guard never applies.
        const headerForView = format === 'parquet' ? undefined : request.hasHeaderRow;
        const statements = translateView(request.variableName, request.view, headerForView, unsupported);
        if (statements.length > 0) {
            lines.push('', '# Filter and sort as shown in the Data Explorer', ...statements);
        }
    }
    lines.push('');

    return { code: lines.join('\n'), unsupported };
}
