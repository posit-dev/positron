/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { JupyterAdapterApi, JupyterKernelSpec, JupyterLanguageRuntime } from './jupyter-adapter';
import { ArkLsp } from './lsp';

export class RRuntime implements positron.LanguageRuntime, vscode.Disposable {
	private _lsp: ArkLsp;
	private _kernel: JupyterLanguageRuntime;

	constructor(
		readonly context: vscode.ExtensionContext,
		readonly kernelSpec: JupyterKernelSpec,
		readonly metadata: positron.LanguageRuntimeMetadata,
		readonly adapterApi: JupyterAdapterApi,
	) {
		this._kernel = adapterApi.adaptKernel(kernelSpec, metadata);
		this._lsp = new ArkLsp(metadata.languageVersion);

		this._lsp.attachRuntime(this._kernel);
		this.onDidChangeRuntimeState = this._kernel.onDidChangeRuntimeState;
		this.onDidReceiveRuntimeMessage = this._kernel.onDidReceiveRuntimeMessage;

		this.onDidChangeRuntimeState((state) => {
			this.onStateChange(state);
		});
	}

	onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage>;

	onDidChangeRuntimeState: vscode.Event<positron.RuntimeState>;

	execute(code: string, id: string, mode: positron.RuntimeCodeExecutionMode, errorBehavior: positron.RuntimeErrorBehavior): void {
		this._kernel.execute(code, id, mode, errorBehavior);
	}

	isCodeFragmentComplete(code: string): Thenable<positron.RuntimeCodeFragmentStatus> {
		return this._kernel.isCodeFragmentComplete(code);
	}

	createClient(id: string, type: positron.RuntimeClientType, params: any): Thenable<void> {
		return this._kernel.createClient(id, type, params);
	}

	listClients(type?: positron.RuntimeClientType | undefined): Thenable<Record<string, string>> {
		return this._kernel.listClients(type);
	}

	removeClient(id: string): void {
		this._kernel.removeClient(id);
	}

	sendClientMessage(clientId: string, messageId: string, message: any): void {
		this._kernel.sendClientMessage(clientId, messageId, message);
	}

	replyToPrompt(id: string, reply: string): void {
		this._kernel.replyToPrompt(id, reply);
	}

	start(): Thenable<positron.LanguageRuntimeInfo> {
		return this._kernel.start();
	}

	interrupt(): void {
		this._kernel.interrupt();
	}

	restart(): void {
		this._lsp.deactivate()?.then(() => {
			this._kernel.restart();
		});
	}

	shutdown(): void {
		this._lsp.deactivate()?.then(() => {
			this._kernel.shutdown();
		});
	}

	dispose() {
		this._lsp.dispose();
	}

	private onStateChange(state: positron.RuntimeState): void {
		if (state === positron.RuntimeState.Ready) {
			this.adapterApi.findAvailablePort([], 25).then((port) => {
				this._kernel.emitJupyterLog(`Starting Positron LSP server on port ${port}`);
				this._kernel.startPositronLsp(`127.0.0.1:${port}`);
				this._lsp.activate(port, this.context);
			});
		}
	}
}
