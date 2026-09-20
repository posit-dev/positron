/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { IServiceContainer } from '../../client/ioc/types';
import { PythonStatementRangeProvider } from '../../client/positron/statementRange';
import { mock } from './utils';

// A container whose only job is to prove it was never asked. The AST path
// needs the interpreter service from it, so a declined document must return
// before reaching in.
const untouchedContainer = mock<IServiceContainer>({
    get: () => {
        throw new Error('the service container must not be used for a declined document');
    },
});

const LINE = 'x = 1';
const document = mock<vscode.TextDocument>({
    lineCount: 1,
    getText: () => LINE,
    lineAt: () => mock<vscode.TextLine>({ text: LINE, range: new vscode.Range(0, 0, 0, LINE.length) }),
});

suite('PythonStatementRangeProvider', () => {
    test('returns undefined for a declined document without consulting the interpreter', async () => {
        const provider = new PythonStatementRangeProvider(untouchedContainer, () => true);

        const result = await provider.provideStatementRange(
            document,
            new vscode.Position(0, 0),
            new vscode.CancellationTokenSource().token,
        );

        assert.strictEqual(result, undefined);
    });

    test('answers a document its predicate accepts', async () => {
        // The throwing container fails the AST path, which is what sends the
        // provider down the regex fallback that answers here.
        const provider = new PythonStatementRangeProvider(untouchedContainer, () => false);

        const result = await provider.provideStatementRange(
            document,
            new vscode.Position(0, 0),
            new vscode.CancellationTokenSource().token,
        );

        assert.strictEqual(result?.code, LINE);
    });
});
