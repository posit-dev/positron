/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { IServiceContainer } from '../../client/ioc/types';
import { PythonStatementRangeProvider } from '../../client/positron/statementRange';
import { mock } from './utils';

const LINE = 'x = 1';
const document = mock<vscode.TextDocument>({
    lineCount: 1,
    getText: () => LINE,
    lineAt: () => mock<vscode.TextLine>({ text: LINE, range: new vscode.Range(0, 0, 0, LINE.length) }),
});

suite('PythonStatementRangeProvider', () => {
    // Resolving a statement range starts by asking the container for the
    // interpreter, so whether the container was asked is what says whether the
    // request got past the decline guard. It throws rather than resolving, so
    // that neither test needs a real interpreter: the provider then falls back
    // to its regex path, which is not what either test is about.
    let askedForServices: boolean;
    let serviceContainer: IServiceContainer;

    setup(() => {
        askedForServices = false;
        serviceContainer = mock<IServiceContainer>({
            get: () => {
                askedForServices = true;
                throw new Error('no interpreter service in this test');
            },
        });
    });

    function provideStatementRange(shouldDecline: boolean) {
        const provider = new PythonStatementRangeProvider(serviceContainer, () => shouldDecline);
        return provider.provideStatementRange(
            document,
            new vscode.Position(0, 0),
            new vscode.CancellationTokenSource().token,
        );
    }

    test('returns undefined for a declined document, without starting the work', async () => {
        const result = await provideStatementRange(true);

        assert.deepStrictEqual({ result, askedForServices }, { result: undefined, askedForServices: false });
    });

    test('starts the work for a document its predicate accepts', async () => {
        await provideStatementRange(false);

        assert.strictEqual(askedForServices, true);
    });
});
