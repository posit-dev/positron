/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as os from 'os';

/**
 * Document paste edit provider for Python files that converts files on the clipboard
 * into file paths that are usable in Python code.
 */
export class PythonFilePasteProvider implements vscode.DocumentPasteEditProvider {
    // Custom kind for Python-formatted file paths
    public static readonly kind = vscode.DocumentDropOrPasteEditKind.Text.append('path', 'python');

    /**
     * Provide paste edits for Python filepaths when files are detected on clipboard.
     */
    async provideDocumentPasteEdits(
        _document: vscode.TextDocument,
        _ranges: readonly vscode.Range[],
        dataTransfer: vscode.DataTransfer,
        _context: vscode.DocumentPasteEditContext,
        _token: vscode.CancellationToken,
    ): Promise<vscode.DocumentPasteEdit[] | undefined> {
        const setting = vscode.workspace.getConfiguration('python').get<boolean>('autoConvertFilePaths');
        if (!setting) {
            return undefined;
        }

        const filePaths = await positron.paths.extractClipboardFilePaths(dataTransfer, {
            preferRelative: true,
            homeUri: vscode.Uri.file(os.homedir()),
        });

        if (!filePaths) {
            return undefined;
        }

        // Format for Python: single path or Python list syntax
        const insertText = filePaths.length === 1 ? filePaths[0] : `[${filePaths.join(', ')}]`;

        return [
            {
                insertText,
                title: vscode.l10n.t('Insert file path(s)'),
                kind: PythonFilePasteProvider.kind,
            },
        ];
    }
}

/**
 * Register the Python file paste provider for automatic file path conversion.
 */
export function registerPythonFilePasteProvider(disposables: vscode.Disposable[]): void {
    const pythonFilePasteProvider = new PythonFilePasteProvider();
    disposables.push(
        vscode.languages.registerDocumentPasteEditProvider({ language: 'python' }, pythonFilePasteProvider, {
            pasteMimeTypes: ['text/uri-list'],
            providedPasteEditKinds: [PythonFilePasteProvider.kind],
        }),
    );
}
