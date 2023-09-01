/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';

/*
 * This file contains the implementation of the StatementRangeProvider interface.
 * The implementation is adapted from the MIT-licensed vscode-jupyter-python
 * extension:
 *
 * https://github.com/kylebarron/vscode-jupyter-python
 *
 * In the future, we may wish to provide a more sophisticated implementation
 * from Jedi or another Python language server; this uses a simple regex-based
 * approach.
 */


/**
 * Move the given position to the start of the line
 *
 * @param position The position to move
 * @returns The position at the start of the line
 */
function movePositionToStartOfLine(position: vscode.Position): vscode.Position {
    return position.with(undefined, 0);
}

/**
 * Get the whitespace at the beginning of the line
 *
 * @param document The document to search
 * @param initialPosition The position to start searching from
 * @returns The whitespace at the beginning of the line
 */
function getInitialIndentTextAtLine(
    document: vscode.TextDocument,
    initialPosition: vscode.Position): string {
    const lineText = document.lineAt(initialPosition.line).text;
    const indent = lineText.match(/^\s+/);
    return indent ? indent[0] : "";
}

/**
 * Expand the given range downward until the end of the code block
 *
 * @param document The document to search
 * @param currentRange The range to expand
 * @param indent The indent of the current line
 * @returns The expanded range
 */
function expandRangeDownward(
    document: vscode.TextDocument,
    currentRange: vscode.Range,
    indent: string
): vscode.Range {
    const expandCodeList: Array<string> = [];
    // add whitespace to the list
    const expandCode = ["\\s"].concat(expandCodeList).join("|");
    const expandRegex = new RegExp(`^(${indent}(${expandCode})|\s*#|\s*$)`);

    const whitespaceOnlyRegex = new RegExp("^\\s*$");

    let nextLineNum = currentRange.end.line + 1;

    // expand code to the bottom
    while (
        nextLineNum < document.lineCount &&
        (document.lineAt(nextLineNum).text.match(whitespaceOnlyRegex) ||
            document.lineAt(nextLineNum).text.match(expandRegex))
    ) {
        nextLineNum += 1;
    }

    const endPosition = document.lineAt(nextLineNum - 1).range.end;
    const endRange = new vscode.Range(currentRange.start, endPosition);
    return endRange;
}

/**
 * A StatementRangeProvider implementation for Python
 */
export class PythonStatementRangeProvider implements positron.StatementRangeProvider {
    // eslint-disable-next-line class-methods-use-this
    provideStatementRange(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken): vscode.ProviderResult<vscode.Range> {

        // When inferring an expanded code range, always start at the beginning of a line
        let initialPosition = movePositionToStartOfLine(position);

        // Move down to the next line that is not whitespace or a comment
        // (this isn't in the original vscode-jupyter-python implementation)
        while (
            initialPosition.line < (document.lineCount - 1) &&
            (document.lineAt(initialPosition.line).text.match(/^\s*#/) ||
                document.lineAt(initialPosition.line).text.match(/^\s*$/))
        ) {
            initialPosition = initialPosition.translate(1);
        }

        const beginRange = new vscode.Range(initialPosition, initialPosition);
        const initialIndentText = getInitialIndentTextAtLine(document, initialPosition);
        const finalRange = expandRangeDownward(document, beginRange, initialIndentText);
        return finalRange;
    }
}
