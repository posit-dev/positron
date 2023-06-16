/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import PQueue from 'p-queue';

import { JupyterAdapterApi, JupyterKernelSpec, JupyterLanguageRuntime, JupyterKernelExtra } from './jupyter-adapter';
import { ArkLsp, LspState } from './lsp';

/**
 * A Positron language runtime that wraps a Jupyter kernel and a Language Server
 * Protocol client.
 */
export class RRuntime implements positron.LanguageRuntime, vscode.Disposable {

	/** The Language Server Protocol client wrapper */
	private _lsp: ArkLsp;

	/** Queue for message handlers */
	private _queue: PQueue;

	/** The Jupyter kernel-based implementation of the Language Runtime API */
	private _kernel: JupyterLanguageRuntime;

	constructor(
		readonly context: vscode.ExtensionContext,
		readonly kernelSpec: JupyterKernelSpec,
		readonly metadata: positron.LanguageRuntimeMetadata,
		readonly adapterApi: JupyterAdapterApi,
		readonly extra?: JupyterKernelExtra,
	) {
		this._kernel = adapterApi.adaptKernel(kernelSpec, metadata, extra);
		this._lsp = new ArkLsp(metadata.languageVersion);

		this.onDidChangeRuntimeState = this._kernel.onDidChangeRuntimeState;
		this.onDidReceiveRuntimeMessage = this._kernel.onDidReceiveRuntimeMessage;

		this.onDidChangeRuntimeState((state) => {
			this.onStateChange(state);
		});

		this._queue = new PQueue({ concurrency: 1 });
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

	async interrupt(): Promise<void> {
		return this._kernel.interrupt();
	}

	async restart(): Promise<void> {
		// Stop the LSP client before restarting the kernel
		await this._lsp.deactivate();
		return this._kernel.restart();
	}

	async shutdown(): Promise<void> {
		// Stop the LSP client before shutting down the kernel
		await this._lsp.deactivate();
		return this._kernel.shutdown();
	}

	dispose() {
		this._lsp.dispose();
	}

	private onStateChange(state: positron.RuntimeState): void {
		if (state === positron.RuntimeState.Ready) {
			this._queue.add(async () => {
				const port = await this.adapterApi.findAvailablePort([], 25);
				this._kernel.emitJupyterLog(`Starting Positron LSP server on port ${port}`);
				this._kernel.startPositronLsp(`127.0.0.1:${port}`);
				await this._lsp.activate(port, this.context);
			});
		} else if (state === positron.RuntimeState.Exited) {
			if (this._lsp.state === LspState.running) {
				this._queue.add(async () => {
					this._kernel.emitJupyterLog(`Stopping Positron LSP server`);
					await this._lsp.deactivate();
				});
			}
		}
	}
}
