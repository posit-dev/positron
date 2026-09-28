/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { quartoCellsKey, quartoCellsUriFor } from '../../client/positron/lsp';
import { mock } from './utils';

suite('quartoCellsUriFor', () => {
    /** An open text document, which is how an untitled document is classified. */
    function openDocument(uri: vscode.Uri, languageId: string): vscode.TextDocument {
        return mock<vscode.TextDocument>({ uri, languageId });
    }

    test('a .qmd path produces the quarto-cells notebook for it', () => {
        const notebookUri = vscode.Uri.file('/home/u/doc.qmd');

        assert.strictEqual(quartoCellsUriFor(notebookUri)?.toString(), 'quarto-cells:/home/u/doc.qmd.ipynb');
    });

    test('a .Rmd path produces the quarto-cells notebook for it, case-insensitively', () => {
        const notebookUri = vscode.Uri.file('/home/u/doc.RMD');

        assert.strictEqual(quartoCellsUriFor(notebookUri)?.toString(), 'quarto-cells:/home/u/doc.RMD.ipynb');
    });

    test('a real .ipynb notebook is not a Quarto session', () => {
        const notebookUri = vscode.Uri.file('/home/u/notebook.ipynb');

        assert.strictEqual(quartoCellsUriFor(notebookUri, []), undefined);
    });

    test('an untitled Quarto document is classified by its language id', () => {
        // _Quarto: New Document_ opens the document with a language id and no
        // path, so the extension alone cannot tell it from any other untitled
        // file. Core names its hidden notebook `Untitled-1.qmd.ipynb`.
        const notebookUri = vscode.Uri.from({ scheme: 'untitled', path: 'Untitled-1' });
        const documents = [openDocument(notebookUri, 'quarto')];

        assert.strictEqual(quartoCellsUriFor(notebookUri, documents)?.toString(), 'quarto-cells:Untitled-1.qmd.ipynb');
    });

    test('an untitled document of another language is not a Quarto session', () => {
        const notebookUri = vscode.Uri.from({ scheme: 'untitled', path: 'Untitled-1' });
        const documents = [openDocument(notebookUri, 'python')];

        assert.strictEqual(quartoCellsUriFor(notebookUri, documents), undefined);
    });

    test('an untitled document that is not open yet is still a Quarto session', () => {
        // A restored session can reach the extension before its document does,
        // and the document selector is built from this answer once. A real
        // notebook would have carried an extension or a notebook type, so what
        // is left is a Quarto document.
        const notebookUri = vscode.Uri.from({ scheme: 'untitled', path: 'Untitled-1' });

        assert.strictEqual(quartoCellsUriFor(notebookUri, [])?.toString(), 'quarto-cells:Untitled-1.qmd.ipynb');
    });

    test('an untitled notebook is not a Quarto session, by its path', () => {
        const notebookUri = vscode.Uri.from({ scheme: 'untitled', path: 'Untitled-1.ipynb' });

        assert.strictEqual(quartoCellsUriFor(notebookUri, []), undefined);
    });

    test('an untitled notebook is not a Quarto session, by its notebook type', () => {
        // Core names an untitled notebook `Untitled-N<ending>` and puts its type
        // in the query. A notebook type with no file ending leaves only the query.
        const notebookUri = vscode.Uri.from({ scheme: 'untitled', path: 'Untitled-1', query: 'some-notebook' });

        assert.strictEqual(quartoCellsUriFor(notebookUri, []), undefined);
    });
});

suite('quartoCellsKey', () => {
    test('ignores a remote authority so the console and a session agree in a remote window', () => {
        // Core builds the hidden notebook from the source URI, so on a remote window it
        // carries the remote authority, while the session derives its own from a metadata
        // URI that arrives here already transformed to a plain file: URI without one.
        const fromCore = vscode.Uri.parse('quarto-cells://ssh-remote%2Bhost/home/u/a.qmd.ipynb');
        const fromSession = vscode.Uri.parse('quarto-cells:/home/u/a.qmd.ipynb');

        assert.strictEqual(quartoCellsKey(fromCore), quartoCellsKey(fromSession));
    });
});
