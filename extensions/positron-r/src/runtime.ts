/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import PQueue from 'p-queue';

import { JupyterAdapterApi, JupyterKernelSpec, JupyterLanguageRuntime, JupyterKernelExtra } from './jupyter-adapter';
import { ArkLsp, LspState } from './lsp';
import { delay } from './util';
import { ArkAttachOnStartup, ArkDelayStartup } from './startup';
import { RHtmlWidget, getResourceRoots } from './htmlwidgets';
import { getRPackageName } from './contexts';

export let lastRuntimePath = '';

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

	/** The emitter for runtime exits */
	private _exitEmitter =
		new vscode.EventEmitter<positron.LanguageRuntimeExit>();

	/** The Jupyter Adapter extension API */
	private adapterApi?: JupyterAdapterApi;

	constructor(
		readonly context: vscode.ExtensionContext,
		readonly kernelSpec: JupyterKernelSpec,
		readonly metadata: positron.LanguageRuntimeMetadata,
		public dynState: positron.LanguageRuntimeDynState,
		readonly extra?: JupyterKernelExtra,
		readonly notebook?: vscode.NotebookDocument,
	) {
		this._lsp = new ArkLsp(metadata.languageVersion, notebook);
		this._queue = new PQueue({ concurrency: 1 });
		this.onDidReceiveRuntimeMessage = this._messageEmitter.event;
		this.onDidChangeRuntimeState = this._stateEmitter.event;
		this.onDidEndSession = this._exitEmitter.event;

		this.onDidChangeRuntimeState((state) => {
			this.onStateChange(state);
		});
	}

	onDidEndSession: vscode.Event<positron.LanguageRuntimeExit>;
	onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage>;
	onDidChangeRuntimeState: vscode.Event<positron.RuntimeState>;

	/**
	 * Opens a resource in the runtime.
	 * @param resource The resource to open.
	 * @returns true if the resource was opened; otherwise, false.
	 */
	openResource(resource: vscode.Uri | string): Thenable<boolean> {
		// If the resource is a string, parse it as a URI.
		if (typeof resource === 'string') {
			resource = vscode.Uri.parse(resource);
		}

		// Dispatch the open.
		switch (resource.scheme) {
			// Help resource.
			case 'x-r-help':
				console.log('*******************************************************');
				console.log(`R runtime should open help resource "${resource.path}"`);
				console.log('*******************************************************');
				return Promise.resolve(true);

			// Vignette resource.
			case 'x-r-vignette':
				console.log('*******************************************************');
				console.log(`R runtime should open vignette resource "${resource.path}"`);
				console.log('*******************************************************');
				return Promise.resolve(true);

			// Unhandled.
			default:
				return Promise.resolve(false);
		}
	}

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
		lastRuntimePath = this._kernel.metadata.runtimePath;
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
			await this._lsp.deactivate(true);
			return this._kernel.restart();
		} else {
			throw new Error('Cannot restart; kernel not started');
		}
	}

	async shutdown(exitReason = positron.RuntimeExitReason.Shutdown): Promise<void> {
		if (this._kernel) {
			// Stop the LSP client before shutting down the kernel
			await this._lsp.deactivate(true);
			return this._kernel.shutdown(exitReason);
		} else {
			throw new Error('Cannot shutdown; kernel not started');
		}
	}

	async forceQuit(): Promise<void> {
		if (this._kernel) {
			// Stop the LSP client before shutting down the kernel. We only give
			// the LSP a quarter of a second to shut down before we force the
			// kernel to quit; we need to balance the need to respond to the
			// force-quit quickly with the fact that the LSP will show error
			// messages if we yank the kernel out from beneath it without
			// warning.
			await Promise.race([
				this._lsp.deactivate(true),
				delay(250)
			]);
			return this._kernel.forceQuit();
		} else {
			throw new Error('Cannot force quit; kernel not started');
		}
	}

	clone(metadata: positron.LanguageRuntimeMetadata, notebook: vscode.NotebookDocument): positron.LanguageRuntime {
		// eslint-disable-next-line @typescript-eslint/naming-convention
		const kernelSpec: JupyterKernelSpec = { ...this.kernelSpec, display_name: metadata.runtimeName };
		return new RRuntime(
			this.context,
			kernelSpec,
			metadata,
			{ ...this.dynState },
			createJupyterKernelExtra(),
			notebook);
	}

	async dispose() {
		await this._lsp.dispose();
		if (this._kernel) {
			await this._kernel.dispose();
		}
	}

	/**
	 * Show runtime log in output panel.
	 */
	showOutput() {
		this._kernel?.showOutput();
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
			this.onMessage(message);
		});
		kernel.onDidEndSession((exit) => {
			this._exitEmitter.fire(exit);
		});

		return kernel;
	}

	/**
	 * Processes a message received from the kernel; amends it with any
	 * necessary metadata and then emits it to Positron.
	 *
	 * @param message The message to process
	 */
	private onMessage(message: positron.LanguageRuntimeMessage): void {
		// Have we delivered the message to Positron yet?
		let delivered = false;

		if (message.type === positron.LanguageRuntimeMessageType.Output) {

			// If this is an R HTML widget, upgrade the message to a web output
			const msg = message as positron.LanguageRuntimeOutput;
			if (Object.keys(msg.data).includes('application/vnd.r.htmlwidget')) {

				// Get the widget data from the message
				const widget = msg.data['application/vnd.r.htmlwidget'] as any as RHtmlWidget;
				const webMsg = msg as positron.LanguageRuntimeWebOutput;

				// Compute all the resource roots; these are the URIs the widget
				// will need to render.
				webMsg.resource_roots = getResourceRoots(widget);

				// Set the output location based on the sizing policy
				const sizing = widget.sizing_policy;
				webMsg.output_location = sizing?.knitr?.figure ?
					positron.PositronOutputLocation.Plot :
					positron.PositronOutputLocation.Viewer;

				// Deliver the message to Positron
				this._messageEmitter.fire(message);
				delivered = true;
			}
		}

		// The message hasn't been delivered yet, so deliver it
		if (!delivered) {
			this._messageEmitter.fire(message);
		}
	}

	private async startLsp(): Promise<void> {
		// The adapter API is guaranteed to exist at this point since the
		// runtime cannot become Ready without it
		const port = await this.adapterApi!.findAvailablePort([], 25);
		if (this._kernel) {
			this._kernel.emitJupyterLog(`Starting Positron LSP server on port ${port}`);
			await this._kernel.startPositronLsp(`127.0.0.1:${port}`);
		}
		this._lsp.activate(port, this.context);
	}

	private async startDap(): Promise<void> {
		if (this._kernel) {
			const port = await this.adapterApi!.findAvailablePort([], 25);
			await this._kernel.startPositronDap(port, 'ark', 'Ark Positron R');
		}
	}

	private onStateChange(state: positron.RuntimeState): void {
		if (state === positron.RuntimeState.Ready) {
			this._queue.add(async () => {
				const lsp = this.startLsp();
				const dap = this.startDap();
				await Promise.all([lsp, dap]);
			});
		} else if (state === positron.RuntimeState.Exited) {
			if (this._lsp.state === LspState.running) {
				this._queue.add(async () => {
					if (this._kernel) {
						this._kernel.emitJupyterLog(`Stopping Positron LSP server`);
					}
					await this._lsp.deactivate(false);
				});
			}
		}
	}
}

export function createJupyterKernelExtra(): JupyterKernelExtra {
	return {
		attachOnStartup: new ArkAttachOnStartup(),
		sleepOnStartup: new ArkDelayStartup(),
	};
}
