/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import {
    LanguageClient,
    Position,
    RequestType,
    State,
    VersionedTextDocumentIdentifier,
} from 'vscode-languageclient/node';

interface HelpTopicParams {
    textDocument: VersionedTextDocumentIdentifier;
    position: Position;
}

interface HelpTopicResponse {
    topic: string;
}

// disabled to match positron-r
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace HelpTopicRequest {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    export const type: RequestType<HelpTopicParams, HelpTopicResponse | undefined, any> = new RequestType(
        'positron/textDocument/helpTopic',
    );
}

/**
 * A HelpTopicProvider implementation for Python
 */
export class PythonHelpTopicProvider implements positron.HelpTopicProvider {
    /**
     * @param _shouldDecline Documents to answer `undefined` for, so that Positron
     *   asks the next provider instead. The console client declines the Quarto
     *   cells that a session of their own serves.
     */
    constructor(
        private readonly _client: LanguageClient,
        private readonly _shouldDecline?: (document: vscode.TextDocument) => boolean,
    ) {}

    async provideHelpTopic(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<string | undefined> {
        // A client keeps its registrations when it stops, and the registry asks
        // the newest first, so a stopped session is asked ahead of the console
        // client that can still answer. Decline rather than reject: a rejection
        // from a dead connection is noise every caller has to survive.
        if (this._client.state !== State.Running || this._shouldDecline?.(document)) {
            return undefined;
        }
        const params: HelpTopicParams = {
            textDocument: this._client.code2ProtocolConverter.asVersionedTextDocumentIdentifier(document),
            position: this._client.code2ProtocolConverter.asPosition(position),
        };

        const response = await this._client.sendRequest(HelpTopicRequest.type, params, token);
        return response?.topic;
    }
}
