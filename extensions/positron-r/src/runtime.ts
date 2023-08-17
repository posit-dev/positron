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
	private _kernel?: JupyterLanguageRuntime;

	/** The emitter for language runtime messages */
	private _messageEmitter =
		new vscode.EventEmitter<positron.LanguageRuntimeMessage>();

	/** The emitter for language runtime state changes */
	private _stateEmitter =
		new vscode.EventEmitter<positron.RuntimeState>();

	/** The Jupyter Adapter extension API */
	private adapterApi?: JupyterAdapterApi;

	constructor(
		readonly context: vscode.ExtensionContext,
		readonly kernelSpec: JupyterKernelSpec,
		readonly metadata: positron.LanguageRuntimeMetadata,
		public dynState: positron.LanguageRuntimeDynState,
		readonly extra?: JupyterKernelExtra,
	) {
		this._lsp = new ArkLsp(metadata.languageVersion);
		this._queue = new PQueue({ concurrency: 1 });
		this.onDidReceiveRuntimeMessage = this._messageEmitter.event;
		this.onDidChangeRuntimeState = this._stateEmitter.event;

		this.onDidChangeRuntimeState((state) => {
			this.onStateChange(state);
		});
	}

	onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage>;
	onDidChangeRuntimeState: vscode.Event<positron.RuntimeState>;

	execute(code: string, id: string, mode: positron.RuntimeCodeExecutionMode, errorBehavior: positron.RuntimeErrorBehavior): void {
		if (this._kernel) {
			this._kernel.execute(code, id, mode, errorBehavior);
		} else {
			throw new Error(`Cannot execute '${code}'; kernel not started`);
		}
	}

	isCodeFragmentComplete(code: string): Thenable<positron.RuntimeCodeFragmentStatus> {
		if (this._kernel) {
			return this._kernel.isCodeFragmentComplete(code);
		} else {
			throw new Error(`Cannot check code fragment '${code}'; kernel not started`);
		}
	}

	createClient(id: string, type: positron.RuntimeClientType, params: any): Thenable<void> {
		if (this._kernel) {
			return this._kernel.createClient(id, type, params);
		} else {
			throw new Error(`Cannot create client of type '${type}'; kernel not started`);
		}
	}

	listClients(type?: positron.RuntimeClientType | undefined): Thenable<Record<string, string>> {
		if (this._kernel) {
			return this._kernel.listClients(type);
		} else {
			throw new Error(`Cannot list clients; kernel not started`);
		}
	}

	removeClient(id: string): void {
		if (this._kernel) {
			this._kernel.removeClient(id);
		} else {
			throw new Error(`Cannot remove client ${id}; kernel not started`);
		}
	}

	sendClientMessage(clientId: string, messageId: string, message: any): void {
		if (this._kernel) {
			this._kernel.sendClientMessage(clientId, messageId, message);
		} else {
			throw new Error(`Cannot send message to client ${clientId}; kernel not started`);
		}
	}

	replyToPrompt(id: string, reply: string): void {
		if (this._kernel) {
			this._kernel.replyToPrompt(id, reply);
		} else {
			throw new Error(`Cannot reply to prompt ${id}; kernel not started`);
		}
	}

	async start(): Promise<positron.LanguageRuntimeInfo> {
		if (!this._kernel) {
			this._kernel = await this.createKernel();
		}
		return this._kernel.start();
	}

	async interrupt(): Promise<void> {
		if (this._kernel) {
			return this._kernel.interrupt();
		} else {
			throw new Error('Cannot interrupt; kernel not started');
		}
	}

	async restart(): Promise<void> {
		if (this._kernel) {
			// Stop the LSP client before restarting the kernel
			await this._lsp.deactivate();
			return this._kernel.restart();
		} else {
			throw new Error('Cannot restart; kernel not started');
		}
	}

	async shutdown(): Promise<void> {
		if (this._kernel) {
			// Stop the LSP client before shutting down the kernel
			await this._lsp.deactivate();
			return this._kernel.shutdown();
		} else {
			throw new Error('Cannot shutdown; kernel not started');
		}
	}

	async dispose() {
		await this._lsp.dispose();
		if (this._kernel) {
			await this._kernel.dispose();
		}
	}

	private async createKernel(): Promise<JupyterLanguageRuntime> {
		const ext = vscode.extensions.getExtension('vscode.jupyter-adapter');
		if (!ext) {
			throw new Error('Jupyter Adapter extension not found');
		}
		if (!ext.isActive) {
			await ext.activate();
		}
		this.adapterApi = ext?.exports as JupyterAdapterApi;
		const kernel = this.adapterApi.adaptKernel(
			this.kernelSpec,
			this.metadata,
			this.dynState,
			this.extra);

		kernel.onDidChangeRuntimeState((state) => {
			this._stateEmitter.fire(state);
		});
		kernel.onDidReceiveRuntimeMessage((message) => {
			this._messageEmitter.fire(message);
		});
		return kernel;
	}

	private onStateChange(state: positron.RuntimeState): void {
		if (state === positron.RuntimeState.Ready) {
			this._queue.add(async () => {
				// The adapter API is guranteed to exist at this point since the
				// runtime cannot become Ready without it
				const port = await this.adapterApi!.findAvailablePort([], 25);
				if (this._kernel) {
					this._kernel.emitJupyterLog(`Starting Positron LSP server on port ${port}`);
					this._kernel.startPositronLsp(`127.0.0.1:${port}`);
				}
				await this._lsp.activate(port, this.context);
			});
		} else if (state === positron.RuntimeState.Exited) {
			if (this._lsp.state === LspState.running) {
				this._queue.add(async () => {
					if (this._kernel) {
						this._kernel.emitJupyterLog(`Stopping Positron LSP server`);
					}
					await this._lsp.deactivate();
				});
			}
		}
	}
}
