/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import {
	LanguageClient,
	TransportKind,
	type LanguageClientOptions,
	type ServerOptions,
} from 'vscode-languageclient/node';

/* Output channel that forwards all messages to trace level */
class TraceOutputChannel implements vscode.OutputChannel {
	readonly name: string;

	constructor(private readonly _log: vscode.LogOutputChannel) {
		this.name = _log.name;
	}

	append(value: string): void {
		this._log.trace(value);
	}

	appendLine(value: string): void {
		this._log.trace(value);
	}

	replace(_value: string): void { }
	clear(): void { }
	show(): void { this._log.show(); }
	hide(): void { this._log.hide(); }
	dispose(): void { }
}

export class LanguageServerClientManager implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];
	public readonly client: LanguageClient;

	constructor(context: vscode.ExtensionContext, outputChannel: vscode.LogOutputChannel) {
		outputChannel.info('[NES LSP] Starting language server...');

		const serverModule = context.asAbsolutePath(path.join('server', 'language-server.js'));
		outputChannel.info(`[NES LSP] Server module path: ${serverModule}`);

		const serverOptions: ServerOptions = {
			run: { module: serverModule, transport: TransportKind.ipc },
			debug: { module: serverModule, transport: TransportKind.ipc },
		};

		const clientOptions: LanguageClientOptions = {
			documentSelector: [{ scheme: 'file', pattern: '**/*' }],
			synchronize: {
				fileEvents: vscode.workspace.createFileSystemWatcher('**/*'),
			},
			outputChannel: new TraceOutputChannel(outputChannel),
		};

		this.client = new LanguageClient(
			'nextEditSuggestionsServer',
			'Next Edit Suggestions Language Server',
			serverOptions,
			clientOptions,
		);

		this._disposables.push(this.client);

		outputChannel.info('[NES LSP] Starting language client...');
		this.client
			.start()
			.then(() => {
				outputChannel.info('[NES LSP] Language client started successfully');
			})
			.catch((err) => {
				outputChannel.error(`[NES LSP] ${err instanceof Error ? err.message : String(err)}`);
			});
	}

	dispose(): void {
		this._disposables.forEach((disposable) => {
			disposable.dispose();
		});
	}
}

let clientManagerInstance: LanguageServerClientManager | undefined;

export function startLanguageServer(context: vscode.ExtensionContext, outputChannel: vscode.LogOutputChannel): void {
	clientManagerInstance = new LanguageServerClientManager(context, outputChannel);
	context.subscriptions.push(clientManagerInstance);
}

export async function stopLanguageServer(): Promise<void> {
	if (clientManagerInstance) {
		await clientManagerInstance.client.stop();
		clientManagerInstance = undefined;
	}
}

export function getLanguageClientManager(): LanguageServerClientManager | undefined {
	return clientManagerInstance;
}
