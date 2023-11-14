/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import { LanguageClient, Position, RequestType, VersionedTextDocumentIdentifier } from 'vscode-languageclient/node';

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
    /** The language client instance */
    private readonly _client: LanguageClient;

    constructor(readonly client: LanguageClient) {
        this._client = client;
    }

    async provideHelpTopic(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<string | undefined> {
        const params: HelpTopicParams = {
            textDocument: this._client.code2ProtocolConverter.asVersionedTextDocumentIdentifier(document),
            position: this._client.code2ProtocolConverter.asPosition(position),
        };

        const response = await this._client.sendRequest(HelpTopicRequest.type, params, token);
        return response?.topic;
    }
}
