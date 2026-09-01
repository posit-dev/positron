/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import { generatePandasImportCode, PYTHON_KEYWORDS } from './pandasCodeGenerator';

/**
 * Builds the pandas data importer, which generates the code that loads a delimited file, Excel
 * workbook, or Parquet file into a dataframe. Generation is pure TypeScript; no Python runtime is
 * involved, so the importer can be built and exercised without registering it.
 */
export function createPandasDataImporter(): positron.DataImporter {
    return {
        languageId: 'python',
        displayName: 'Python (pandas)',
        fileExtensions: ['csv', 'tsv', 'xlsx', 'parquet', 'parq'],
        reservedNames: [...PYTHON_KEYWORDS],
        generateCode: (request: positron.DataImportRequest): positron.DataImportResult =>
            generatePandasImportCode({
                filePath: request.fileUri.fsPath,
                variableName: request.variableName,
                hasHeaderRow: request.options.hasHeaderRow,
                sheetName: request.options.sheetName,
                view: request.view,
            }),
    };
}

/** Registers the pandas data importer with the Data Explorer. */
export function registerPandasDataImporter(disposables: vscode.Disposable[]): void {
    disposables.push(positron.dataExplorer.registerDataImporter(createPandasDataImporter()));
}
