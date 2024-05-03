/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { timeout } from './util';
import { randomUUID } from 'crypto';
import { RSessionManager } from './session-manager';
import { Disposable, DocumentOnTypeFormattingParams, RequestType, TextDocumentIdentifier } from 'vscode-languageclient';
import { LanguageClient } from 'vscode-languageclient/node';

export async function registerFormatter(context: vscode.ExtensionContext) {

	const rDocumentSelector = { scheme: 'file', language: 'r' } as vscode.DocumentSelector;

	context.subscriptions.push(
		vscode.languages.registerDocumentFormattingEditProvider(
			rDocumentSelector,
			new FormatterProvider()
		),
		vscode.languages.registerDocumentRangeFormattingEditProvider(
			rDocumentSelector,
			new FormatterProvider()
		)
	);
}

class FormatterProvider implements vscode.DocumentFormattingEditProvider {
	constructor() { }

	public provideDocumentFormattingEdits(document: vscode.TextDocument):
		vscode.ProviderResult<vscode.TextEdit[]> {
		return this.formatDocument(document);
	}

	public provideDocumentRangeFormattingEdits(
		document: vscode.TextDocument,
		range: vscode.Range,
	): vscode.ProviderResult<vscode.TextEdit[]> {
		return this.formatDocument(document, range);
	}

	private async formatDocument(
		document: vscode.TextDocument,
		range?: vscode.Range
	): Promise<vscode.TextEdit[]> {
		const session = RSessionManager.instance.getConsoleSession();
		if (!session) {
			return [];
		}
		const id = randomUUID();
		const isInstalled = await session.checkInstalled('styler');
		if (!isInstalled) {
			return [];
		}

		// We can only use styler on files right now, so write the document to a temp file
		const originalSource = document.getText(range);
		const tempdir = os.tmpdir();
		const fileToStyle = 'styler-' + randomUUID() + '.R';
		const stylerPath = path.join(tempdir, fileToStyle);
		fs.writeFileSync(stylerPath, originalSource);

		// A promise that resolves when the runtime is idle:
		const promise = new Promise<void>(resolve => {
			const disp = session.onDidReceiveRuntimeMessage(runtimeMessage => {
				if (runtimeMessage.parent_id === id &&
					runtimeMessage.type === positron.LanguageRuntimeMessageType.State) {
					const runtimeMessageState = runtimeMessage as positron.LanguageRuntimeState;
					if (runtimeMessageState.state === positron.RuntimeOnlineState.Idle) {
						resolve();
						disp.dispose();
					}
				}
			});
		});

		// Actual formatting is done by styler
		session.execute(
			`styler::style_file('${stylerPath}')`,
			id,
			positron.RuntimeCodeExecutionMode.Silent,
			positron.RuntimeErrorBehavior.Continue);

		// Wait for the the runtime to be idle, or for the timeout:
		await Promise.race([promise, timeout(2e4, 'waiting for formatting')]);

		// Read the now formatted file and then delete it
		const formattedSource = fs.readFileSync(stylerPath).toString();
		fs.promises.unlink(stylerPath);

		// Return the formatted source
		const fileStart = new vscode.Position(0, 0);
		const fileEnd = document.lineAt(document.lineCount - 1).range.end;
		const edit = vscode.TextEdit.replace(
			range || new vscode.Range(fileStart, fileEnd),
			formattedSource
		);
		return [edit];
	}
}

// This is a workaround for Ark's current LSP server implementation not
// following the message order when handling requests. We send a versioned
// document (unlike the OnTypeFormatting LSP request which doesn't include a
// version) to let Ark detect out of order messages.
export function registerOnTypeFormatter(client: LanguageClient): Disposable {
	const rSel = { scheme: 'file', language: 'r' } as vscode.DocumentSelector;
	return vscode.languages.registerOnTypeFormattingEditProvider(rSel, new ROnTypeFormattingEditProvider(client), '\n');
}

class ROnTypeFormattingEditProvider implements vscode.OnTypeFormattingEditProvider {
	public constructor(private _client: LanguageClient) { }

	public async provideOnTypeFormattingEdits(
		document: vscode.TextDocument,
		position: vscode.Position,
		ch: string,
		options: vscode.FormattingOptions,
		token: vscode.CancellationToken
	): Promise<vscode.TextEdit[]> {
		// Include document version in the request. The request uses this for
		// extensibility, so we store the version there.
		options.version = document.version;

		let params = <DocumentOnTypeFormattingParams>{
			textDocument: { uri: document.uri.toString() },
			position,
			ch,
			options,
		};

		return await this._client.sendRequest('textDocument/onTypeFormatting', params, token);
	}
}
