/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { LanguageClient, State } from 'vscode-languageclient/node';
import { PythonHelpTopicProvider } from '../../client/positron/help';
import { mock } from './utils';

// A running client whose only job is to prove it was never asked. Running, so
// that the decline test turns on the predicate and not on the client's state.
const untouchedClient = {
    state: State.Running,
    sendRequest: () => {
        throw new Error('the client must not be asked about a declined document');
    },
} as unknown as LanguageClient;

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
    function provideHelpTopic(client: LanguageClient, shouldDecline: boolean): Promise<string | undefined> {
        const provider = new PythonHelpTopicProvider(client, () => shouldDecline);
        return provider.provideHelpTopic(
            document,
            new vscode.Position(0, 0),
            new vscode.CancellationTokenSource().token,
        );
    }

    test('returns undefined when its client has stopped', async () => {
        // Nothing declines this document, so only the client's own state can
        // keep the request from reaching a dead connection.
        assert.strictEqual(await provideHelpTopic(stoppedClient, false), undefined);
    });

    test('returns undefined for a declined document, without asking its running client', async () => {
        assert.strictEqual(await provideHelpTopic(untouchedClient, true), undefined);
    });
});
