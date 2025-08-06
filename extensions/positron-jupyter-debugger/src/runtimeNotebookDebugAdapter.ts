/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { DebugProtocol } from '@vscode/debugprotocol';
import * as vscode from 'vscode';
import { DebugProtocolTransformer } from './debugProtocolTransformer.js';
import { JupyterRuntimeDebugAdapter } from './runtimeDebugAdapter.js';
import { DisposableStore, formatDebugMessage } from './util.js';

export class JupyterRuntimeNotebookDebugAdapter implements vscode.DebugAdapter, vscode.Disposable {
	private readonly _disposables = new DisposableStore();
	private readonly _onDidSendMessage = this._disposables.add(new vscode.EventEmitter<vscode.DebugProtocolMessage>());
	private readonly _onDidCompleteConfiguration = this._disposables.add(new vscode.EventEmitter<void>());
	private _cellUriByCodeId = new Map<string, string>();
	private readonly _transformer: DebugProtocolTransformer;

	public readonly onDidSendMessage = this._onDidSendMessage.event;
	public readonly onDidCompleteConfiguration = this._onDidCompleteConfiguration.event;

	constructor(
		private readonly _adapter: JupyterRuntimeDebugAdapter,
		private readonly _notebook: vscode.NotebookDocument
	) {
		this._transformer = new DebugProtocolTransformer({
			location(location) {
				if (location.source?.path && this._cellUriByCodeId.has(location.source.path)) {
					return {
						...location,
						source: {
							sourceReference: 0, // Editor should not try to retrieve this source since its a known cell URI.
							path: this._cellUriByCodeId.get(location.source.path),
						},
					};
				}
				return location;
			}
		});

		this._disposables.add(this._adapter.onDidSendMessage((message) => {
			try {
				const runtimeMessage = this._transformer.transform(message as DebugProtocol.ProtocolMessage);
				this._log.debug(`[notebook] >>> SEND ${formatDebugMessage(runtimeMessage)}`);
				this._onDidSendMessage.fire(runtimeMessage);
			} catch (error) {
				this._adapter.log.error(`[notebook] Error transforming message: ${formatDebugMessage(message as DebugProtocol.ProtocolMessage)}`, error);
				throw error;
			}
		}));

		this._disposables.add(this._adapter.onDidCompleteConfiguration(() => {
			this._onDidCompleteConfiguration.fire();
		}));

		this._disposables.add(this._adapter.onDidUpdateCodeIdOptions(() => {
			// TODO: Block debugging until this is done?
			// TODO: Update the map when a cell's source changes.
			for (const cell of this._notebook.getCells()) {
				const code = cell.document.getText();
				const codeId = this._adapter.getCodeId(code);
				this._cellUriByCodeId.set(codeId, cell.document.uri.toString());
			}
		}));
	}

	private get _log(): vscode.LogOutputChannel {
		return this._adapter.log;
	}

	public handleMessage(message: DebugProtocol.ProtocolMessage): void {
		this._log.debug(`[notebook] <<< RECV ${formatDebugMessage(message)}`);
		this.handleMessageAsync(message).catch((error) => {
			this._log.error(`[notebook] Error handling message: ${formatDebugMessage(message)}`, error);
			// TODO: should still respond with an error response...
		});
	}

	private async handleMessageAsync(message: DebugProtocol.ProtocolMessage): Promise<void> {
		switch (message.type) {
			case 'request':
				return await this.handleRequest(message as DebugProtocol.Request);
		}
		// TODO: Don't we need to handle events and responses too?
	}

	private async handleRequest(request: DebugProtocol.Request): Promise<void> {
		switch (request.command) {
			case 'setBreakpoints':
				return await this.handleSetBreakpointsRequest(request as DebugProtocol.SetBreakpointsRequest);
			// case 'stackTrace':
			// 	return await this.handleStackTraceRequest(request as DebugProtocol.StackTraceRequest);
		}
		this._adapter.handleMessage(request);
	}

	private async handleSetBreakpointsRequest(request: DebugProtocol.SetBreakpointsRequest): Promise<void> {
		// Intercept setBreakpoint requests from the client,
		// dump the source cell, and replace with the temp file path.
		const cellUri = request.arguments.source.path;
		if (!cellUri) {
			throw new Error('No cell URI provided.');
		}
		const cell = this._notebook.getCells().find((cell) => cell.document.uri.toString() === cellUri);

		// TODO: Abstract source mapping...
		//       i.e. client request.arguments.source.path (cell URI, console history item URI?)
		//            -> kernel temp file path

		if (!cell) {
			// Fall back to the runtime debug adapter.
			// TODO: Raise an error?...
			this._adapter.handleMessage(request);
			return;
		}

		// Dump the cell into a temp file.
		const code = cell.document.getText();
		const dumpCellResponse = await this._adapter.dumpCell(code);

		// Replace the cell URI in the request source path with the temp file path.
		const runtimeRequest = {
			...request,
			arguments: {
				...request.arguments,
				source: {
					...request.arguments.source,
					path: dumpCellResponse.sourcePath,
				},
			},
		};

		// Send the request to the runtime.
		this._adapter.handleMessage(runtimeRequest);
	}

	dispose(): void {
		this._disposables.dispose();
	}
}
