/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { DebugProtocol } from '@vscode/debugprotocol';
import * as vscode from 'vscode';
import { DebugProtocolTransformer } from './debugProtocolTransformer.js';
import { JupyterRuntimeDebugAdapter } from './runtimeDebugAdapter.js';
import { DisposableStore, formatDebugMessage } from './util.js';
import { NotebookCell } from 'vscode';

export class JupyterRuntimeNotebookDebugAdapter implements vscode.DebugAdapter, vscode.Disposable {
	private readonly _disposables = new DisposableStore();
	private readonly _onDidSendMessage = this._disposables.add(new vscode.EventEmitter<vscode.DebugProtocolMessage>());
	private readonly _onDidCompleteConfiguration = this._disposables.add(new vscode.EventEmitter<void>());
	private _cellUriByCodeId = new Map<string, string>();
	private _codeIdByCellUri = new Map<string, string>();
	private readonly _runtimeToClientTransformer: DebugProtocolTransformer;
	private readonly _clientToRuntimeTransformer: DebugProtocolTransformer;

	public readonly onDidSendMessage = this._onDidSendMessage.event;
	public readonly onDidCompleteConfiguration = this._onDidCompleteConfiguration.event;

	constructor(
		private readonly _adapter: JupyterRuntimeDebugAdapter,
		private readonly _notebook: vscode.NotebookDocument
	) {
		const cellUriByCodeId = this._cellUriByCodeId;
		const codeIdByCellUri = this._codeIdByCellUri;
		this._runtimeToClientTransformer = new DebugProtocolTransformer({
			location(location) {
				const cellUri = location.source?.path && cellUriByCodeId.get(location.source.path);
				if (!cellUri) {
					return location;
				}
				return {
					...location,
					source: {
						...location.source,
						sourceReference: 0, // Editor should not try to retrieve this source since its a known cell URI.
						path: cellUri,
					},
				};
			}
		});
		this._clientToRuntimeTransformer = new DebugProtocolTransformer({
			location(location) {
				const codeId = location.source?.path && codeIdByCellUri.get(location.source.path);
				if (!codeId) {
					return location;
				}
				return {
					...location,
					source: {
						...location.source,
						path: codeId,
					},
				};
			}
		});

		this._disposables.add(this._adapter.onDidSendMessage(async (message) => {
			const runtimeMessage = message as DebugProtocol.ProtocolMessage;

			let clientMessage = runtimeMessage;
			try {
				clientMessage = this._runtimeToClientTransformer.transform(runtimeMessage);
			} catch (error) {
				this._log.error(`[notebook] Error transforming message: ${formatDebugMessage(message as DebugProtocol.ProtocolMessage)}`, error);
			}
			this._log.debug(`[notebook] >>> SEND ${formatDebugMessage(clientMessage)}`);
			this._onDidSendMessage.fire(clientMessage);

			// TODO: Feel like this logic can rather live in the listener.
			if (runtimeMessage.type === 'response' &&
				(runtimeMessage as DebugProtocol.Response).command === 'configurationDone') {
				this._onDidCompleteConfiguration.fire();
			}
		}));

		this._disposables.add(this._adapter.onDidUpdateCodeIdOptions(() => {
			this.updateCellUriByCodeId();
		}));
		if (this._adapter.codeIdOptions) {
			this.updateCellUriByCodeId();
		}
	}

	private updateCellUriByCodeId(): void {
		// TODO: Block debugging until this is done?
		// TODO: Update the map when a cell's source changes.
		this._cellUriByCodeId.clear();
		this._codeIdByCellUri.clear();
		for (const cell of this._notebook.getCells()) {
			const cellUri = cell.document.uri.toString();
			const code = cell.document.getText();
			const codeId = this._adapter.getCodeId(code);
			this._cellUriByCodeId.set(codeId, cellUri);
			this._codeIdByCellUri.set(cellUri, codeId);
		}
	}

	private get _log(): vscode.LogOutputChannel {
		return this._adapter.log;
	}

	public handleMessage(message: DebugProtocol.ProtocolMessage): void {
		this._log.debug(`[notebook] <<< RECV ${formatDebugMessage(message)}`);
		this.handleMessageAsync(message).catch((error) => {
			this._log.error(`[notebook] Error handling message: ${formatDebugMessage(message)}`, error);
		});
	}

	private async handleMessageAsync(clientMessage: DebugProtocol.ProtocolMessage): Promise<void> {
		await this.maybeDumpCell(clientMessage);

		let runtimeMessage = clientMessage;
		try {
			runtimeMessage = this._clientToRuntimeTransformer.transform(clientMessage);
		} catch (error) {
			this._log.error(`[notebook] Error transforming message: ${formatDebugMessage(clientMessage)}`, error);
		}

		// Send the message to the runtime.
		this._adapter.handleMessage(runtimeMessage);
	}

	private async maybeDumpCell(message: DebugProtocol.ProtocolMessage): Promise<void> {
		// Intercept setBreakpoint requests from the client,
		// dump the source cell, and replace with the temp file path.
		if (message.type !== 'request') {
			return;
		}

		const request = message as DebugProtocol.Request;
		if (request.command !== 'setBreakpoints') {
			return;
		}

		const setBreakpointsRequest = request as DebugProtocol.SetBreakpointsRequest;
		const cellUri = setBreakpointsRequest.arguments.source.path;
		if (!cellUri) {
			return;
		}

		const cell = this._notebook.getCells().find((cell) => cell.document.uri.toString() === cellUri);
		if (!cell) {
			return;
		}

		await this.dumpCell(cell);
	}

	private async dumpCell(cell: NotebookCell): Promise<void> {
		const code = cell.document.getText();
		const { sourcePath: codeId } = await this._adapter.dumpCell(code);
		this._cellUriByCodeId.set(codeId, cell.document.uri.toString());
		this._codeIdByCellUri.set(cell.document.uri.toString(), codeId);
	}

	dispose(): void {
		this._disposables.dispose();
	}
}
