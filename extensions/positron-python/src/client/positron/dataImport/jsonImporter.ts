/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import { PYTHON_KEYWORDS } from './pandasCodeGenerator';

/**
 * Generates the code that loads a JSON file with the standard library's json module.
 * @param pathLiteral The path as a ready-to-embed string literal, already quoted and escaped.
 * @param variableName The target variable name.
 */
export function generateJsonImportCode(pathLiteral: string, variableName: string): string {
    return [
        'import json',
        '',
        `# Load ${variableName} data`,
        `with open(${pathLiteral}, encoding='utf-8') as f:`,
        `    ${variableName} = json.load(f)`,
        '',
    ].join('\n');
}

/**
 * Builds the json data importer, which generates the code that loads a JSON file.
 */
export function createJsonDataImporter(): positron.DataImporter {
    return {
        languageId: 'python',
        displayName: 'Python (json)',
        fileExtensions: ['json'],
        reservedNames: [...PYTHON_KEYWORDS],
        generateCode: async (request: positron.DataImportRequest): Promise<positron.DataImportResult> => ({
            code: generateJsonImportCode(
                // Workspace-relative when the file is inside the workspace; absolute otherwise.
                await positron.paths.formatPathForCode(request.fileUri.fsPath, { relativeTo: 'workspace' }),
                request.variableName,
            ),
        }),
    };
}

/** Registers the json data importer. */
export function registerJsonDataImporter(disposables: vscode.Disposable[]): void {
    disposables.push(positron.dataExplorer.registerDataImporter(createJsonDataImporter()));
}
