/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as os from 'os';

/**
 * Document paste and drop edit provider for Python files that converts files on the clipboard or
 * files being shift+dragged+and+dropped into file paths that are usable in Python code.
 */
export class PythonFilePasteAndDropProvider
    implements vscode.DocumentPasteEditProvider, vscode.DocumentDropEditProvider {
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
        const edit = await this.getEdit(dataTransfer);
        if (!edit) {
            return undefined;
        }

        return [
            {
                insertText: edit.insertText,
                title: edit.title,
                kind: PythonFilePasteAndDropProvider.kind,
            },
        ];
    }

    /**
     * Provide drop edits for Python filepaths when files are dropped into the editor.
     */
    async provideDocumentDropEdits(
        _document: vscode.TextDocument,
        _position: vscode.Position,
        dataTransfer: vscode.DataTransfer,
        _token: vscode.CancellationToken,
    ): Promise<vscode.DocumentDropEdit | undefined> {
        const edit = await this.getEdit(dataTransfer);
        if (!edit) {
            return undefined;
        }

        const dropEdit = new vscode.DocumentDropEdit(edit.insertText);
        dropEdit.title = edit.title;
        dropEdit.kind = PythonFilePasteAndDropProvider.kind;
        return dropEdit;
    }

    /**
     * Shared logic to extract and format file paths for both paste and drop operations.
     */
    private async getEdit(
        dataTransfer: vscode.DataTransfer,
    ): Promise<{ insertText: string; title: string } | undefined> {
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

        const title = filePaths.length === 1 ? vscode.l10n.t('Insert file path') : vscode.l10n.t('Insert file paths');

        return { insertText, title };
    }
}

/**
 * Register the Python file paste and drop provider for automatic file path conversion.
 */
export function registerPythonFilePasteAndDropProvider(disposables: vscode.Disposable[]): void {
    const pythonFilePasteAndDropProvider = new PythonFilePasteAndDropProvider();
    disposables.push(
        vscode.languages.registerDocumentPasteEditProvider({ language: 'python' }, pythonFilePasteAndDropProvider, {
            pasteMimeTypes: ['text/uri-list'],
            providedPasteEditKinds: [PythonFilePasteAndDropProvider.kind],
        }),
        vscode.languages.registerDocumentDropEditProvider({ language: 'python' }, pythonFilePasteAndDropProvider, {
            dropMimeTypes: ['text/uri-list'],
            providedDropEditKinds: [PythonFilePasteAndDropProvider.kind],
        }),
    );
}
