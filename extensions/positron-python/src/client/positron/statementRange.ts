/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as internalScripts from '../common/process/internal/scripts';
import { IProcessServiceFactory } from '../common/process/types';
import { createDeferred } from '../common/utils/async';
import { IInterpreterService } from '../interpreter/contracts';
import { IServiceContainer } from '../ioc/types';

/*
 * This file contains an implementation of the StatementRangeProvider interface.
 * It first tries to use a Python script that parses the AST of the document.
 * If that fails, it falls back to a simple regex-based approach, adapted from
 * the MIT-licensed vscode-jupyter-python extension:
 *
 * https://github.com/kylebarron/vscode-jupyter-python
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
function getInitialIndentTextAtLine(document: vscode.TextDocument, initialPosition: vscode.Position): string {
    const lineText = document.lineAt(initialPosition.line).text;
    const indent = lineText.match(/^\s+/);
    return indent ? indent[0] : '';
}

/**
 * Expand the given range downward until the end of the code block
 *
 * @param document The document to search
 * @param currentRange The range to expand
 * @param indent The indent of the current line
 * @returns The expanded range
 */
function expandRangeDownward(document: vscode.TextDocument, currentRange: vscode.Range, indent: string): vscode.Range {
    const expandCodeList = ['else', 'elif', 'except', 'finally', '\\}', '\\]', '\\)'];
    // add whitespace to the list
    const expandCode = ['\\s'].concat(expandCodeList).join('|');
    const expandRegex = new RegExp(`^(${indent}(${expandCode})|\s*#|\s*$)`);

    const whitespaceOnlyRegex = new RegExp('^\\s*$');

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

/*
 * Determine the range of the statement at the given position, using a Python script to parse the AST.
 * Adapted from `CodeExecutionHelper.normalizeLines`.
 */
async function provideStatementRangeFromAst(
    document: vscode.TextDocument,
    position: vscode.Position,
    serviceContainer: IServiceContainer,
): Promise<positron.StatementRange> {
    const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
    const processServiceFactory = serviceContainer.get<IProcessServiceFactory>(IProcessServiceFactory);

    const interpreter = await interpreterService.getActiveInterpreter();
    const processService = await processServiceFactory.create();

    const [args, parse] = internalScripts.normalizeSelection();
    const observable = processService.execObservable(interpreter?.path || 'python', args, {
        throwOnStdErr: true,
    });
    const outputPromise = createDeferred<string>();

    // Accumulate lines from stdout, and resolve the output promise when done.
    let stdout = '';
    observable.out.subscribe({
        next: (output) => {
            if (output.source === 'stdout') {
                stdout += output.out;
            }
        },
        complete: () => {
            outputPromise.resolve(stdout);
        },
        error: (error) => {
            outputPromise.reject(error);
        },
    });
    // Write the input, as JSON, to stdin.
    const input = JSON.stringify({
        wholeFileContent: document.getText(),
        startLine: position.line,
        endLine: position.line,
        // Hardcode these to true so that smart send is enabled in the script.
        emptyHighlight: true,
        smartSendExperimentEnabled: true,
        smartSendSettingsEnabled: true,
    });
    observable.proc?.stdin?.write(input);
    observable.proc?.stdin?.end();

    const outputRaw = await outputPromise.promise;
    const output = JSON.parse(outputRaw);

    // Unfortunately, the script handles code with a syntax error by returning 'deprecated', and by
    // only returning the `normalized` key. We use that information to distinguish from the user
    // trying to actually execute the code 'deprecated' (e.g. if it's a variable in their script).
    if (Object.keys(output).length === 1 && output.normalized === 'deprecated') {
        throw new Error('Failed to parse the Python script.');
    }

    return {
        // parse() doesn't do anything at the time of writing this, but we call it on
        // object.normalized anyway since that's how it's used upstream.
        code: parse(output.normalized),
        range: new vscode.Range(
            // The normalization script uses 1-indexed lines, vscode uses 0-indexed.
            new vscode.Position(output.startLine - 1, output.startCharacter),
            new vscode.Position(output.endLine - 1, output.endCharacter),
        ),
    };
}

/**
 * A StatementRangeProvider implementation for Python
 */
export class PythonStatementRangeProvider implements positron.StatementRangeProvider {
    constructor(private readonly serviceContainer: IServiceContainer) {}

    async provideStatementRange(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
    ): Promise<positron.StatementRange | undefined> {
        // Try to use the AST to get the statement range, fall back to a simpler regex-based approach.
        try {
            return await provideStatementRangeFromAst(document, position, this.serviceContainer);
        } catch {
            // When inferring an expanded code range, always start at the beginning of a line
            let initialPosition = movePositionToStartOfLine(position);

            // Move down to the next line that is not whitespace or a comment
            // (this isn't in the original vscode-jupyter-python implementation)
            while (
                initialPosition.line < document.lineCount - 1 &&
                (document.lineAt(initialPosition.line).text.match(/^\s*#/) ||
                    document.lineAt(initialPosition.line).text.match(/^\s*$/))
            ) {
                initialPosition = initialPosition.translate(1);
            }

            const beginRange = new vscode.Range(initialPosition, initialPosition);
            const initialIndentText = getInitialIndentTextAtLine(document, initialPosition);
            const finalRange = expandRangeDownward(document, beginRange, initialIndentText);

            let code = document.getText(finalRange);

            // Remove comment lines.
            // Regex flags:
            // - 'g' for global search, to look through the entire string
            // - 'm' for multiline search, so that '^' and '$' match the beginning and end of each line
            //   instead of the entire string
            code = code.replace(/^\s*#.*$/gm, '');

            // Ensure that multiline statements end with a single newline.
            if (code.split(/\r?\n/).length > 1) {
                code = `${code.trimEnd()}\n`;
            }

            return { code, range: finalRange };
        }
    }
}
