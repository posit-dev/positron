/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generates the pandas code that loads a data file into a dataframe. Pure functions with no
 * imports: no Python runtime is involved in generation, and no VS Code or Positron API is needed,
 * which keeps the whole module unit-testable.
 */

/** A request to generate a pandas load statement. */
export interface PandasImportRequest {
    /** The absolute path of the file to load. */
    filePath: string;

    /** The target dataframe variable name. */
    variableName: string;

    /** Whether the first row holds column names. Treated as true when absent. */
    hasHeaderRow?: boolean;
}

/**
 * Escapes a string so it can be embedded in a double-quoted, single-line Python literal. Windows
 * paths are the reason this exists: an unescaped backslash before a 'n' or a 't' silently changes
 * the path. POSIX paths are the reason control characters are handled too: a file name may legally
 * contain a newline, which would otherwise terminate the generated literal.
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

/** Whether a path names a tab-separated file, which pandas needs told explicitly. */
function isTabSeparated(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.tsv');
}

/**
 * Generates the pandas code that loads a file into a dataframe.
 *
 * The comment sits directly above the call rather than above the import, so it labels the thing it
 * describes, and it names the variable so a script that accumulates several imports stays readable.
 */
export function generatePandasImportCode(request: PandasImportRequest): string {
    const args = [`"${escapePythonString(request.filePath)}"`];
    if (isTabSeparated(request.filePath)) {
        args.push('sep="\\t"');
    }
    if (request.hasHeaderRow === false) {
        args.push('header=None');
    }

    return [
        'import pandas as pd',
        '',
        `# Load ${request.variableName} data`,
        `${request.variableName} = pd.read_csv(${args.join(', ')})`,
        '',
    ].join('\n');
}
