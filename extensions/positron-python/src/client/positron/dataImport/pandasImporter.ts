/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import { generatePandasImportCode, PYTHON_KEYWORDS } from './pandasCodeGenerator';

/**
 * Registers the pandas data importer, which generates the code that loads a delimited file into a
 * dataframe. Generation is pure TypeScript; no Python runtime is involved.
 */
export function registerPandasDataImporter(disposables: vscode.Disposable[]): void {
    const importer: positron.DataImporter = {
        languageId: 'python',
        displayName: 'Python (pandas)',
        fileExtensions: ['csv', 'tsv'],
        reservedNames: [...PYTHON_KEYWORDS],
        generateCode: async (request: positron.DataImportRequest): Promise<positron.DataImportResult> =>
            generatePandasImportCode({
                // Workspace-relative when the file is inside the workspace, so the generated
                // code survives version control and other machines; absolute otherwise.
                pathLiteral: await positron.paths.formatPathForCode(request.fileUri.fsPath, {
                    relativeTo: 'workspace',
                }),
                variableName: request.variableName,
                hasHeaderRow: request.options.hasHeaderRow,
                view: request.view,
            }),
    };

    disposables.push(positron.dataExplorer.registerDataImporter(importer));
}
