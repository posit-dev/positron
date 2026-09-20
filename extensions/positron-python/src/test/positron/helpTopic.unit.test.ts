/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { LanguageClient, State } from 'vscode-languageclient/node';
import { PythonHelpTopicProvider } from '../../client/positron/help';
import { mock } from './utils';

// A client that has stopped, as a session's client does when its session is
// shut down. Its provider registrations outlive it, so it is still asked.
const stoppedClient = {
    state: State.Stopped,
    sendRequest: () => {
        throw new Error('a stopped client must not be asked at all');
    },
} as unknown as LanguageClient;

const document = mock<vscode.TextDocument>({});

suite('PythonHelpTopicProvider', () => {
    test('returns undefined when its client has stopped', async () => {
        // Nothing accepts this document, so only the client's own state can
        // keep the request from reaching a dead connection.
        const provider = new PythonHelpTopicProvider(stoppedClient, () => false);

        const result = await provider.provideHelpTopic(
            document,
            new vscode.Position(0, 0),
            new vscode.CancellationTokenSource().token,
        );

        assert.strictEqual(result, undefined);
    });

    test('returns undefined for a declined document', async () => {
        const provider = new PythonHelpTopicProvider(stoppedClient, () => true);

        const result = await provider.provideHelpTopic(
            document,
            new vscode.Position(0, 0),
            new vscode.CancellationTokenSource().token,
        );

        assert.strictEqual(result, undefined);
    });
});
