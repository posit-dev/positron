/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { quartoCellsKey } from '../../client/positron/lsp';

suite('quartoCellsKey', () => {
    test('ignores a remote authority so the console and a session agree in a remote window', () => {
        const fromCore = vscode.Uri.parse('quarto-cells://ssh-remote%2Bhost/home/u/a.qmd.ipynb');
        const fromSession = vscode.Uri.parse('quarto-cells:/home/u/a.qmd.ipynb');

        assert.strictEqual(quartoCellsKey(fromCore), quartoCellsKey(fromSession));
    });
});
