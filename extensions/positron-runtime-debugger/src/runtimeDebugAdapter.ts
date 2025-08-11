/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { DebugProtocol } from '@vscode/debugprotocol';
import { randomUUID } from 'crypto';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { DebugInfoArguments, DebugInfoResponseBody, DumpCellArguments, DumpCellResponseBody } from './jupyterDebugProtocol.js';
import { Disposable, formatDebugMessage } from './util.js';
import { DebugProtocolTransformer } from './debugProtocolTransformer.js';
import { LocationMapper } from './types.js';

export interface RuntimeDebugAdapterOptions {
	/**
	 * The location mapper used to convert between client and runtime locations.
	 */
	locationMapper: LocationMapper;

	/**
	 * The runtime debugger log output channel.
	 */
	outputChannel: vscode.LogOutputChannel;

	/**
	 * The associated debug session.
	 */
	debugSession: vscode.DebugSession;

	/**
	 * The associated language runtime session.
	 */
	runtimeSession: positron.LanguageRuntimeSession;
}

/**
 * Debug adapter that bridges VS Code's debug protocol with Positron runtimes that support
 * the {@link https://jupyter-client.readthedocs.io/en/latest/messaging.html#additions-to-the-dap Jupyter debugging protocol}.
 */
export class RuntimeDebugAdapter extends Disposable implements vscode.DebugAdapter, vscode.Disposable {
	private readonly _onDidSendMessage = this._register(new vscode.EventEmitter<vscode.DebugProtocolMessage>());
	private readonly _onDidRefreshState = this._register(new vscode.EventEmitter<DebugInfoResponseBody>());
	private readonly _locationMapper: LocationMapper;
	private readonly _log: vscode.LogOutputChannel;
	private readonly _debugSession: vscode.DebugSession;
	private readonly _runtimeSession: positron.LanguageRuntimeSession;

	/* Tracks IDs of pending debug requests to the runtime. */
	private readonly _pendingRequestIds = new Set<string>();

	/* Transforms messages from runtime to client format. */
	private readonly _runtimeToClientTransformer: DebugProtocolTransformer;

	/* Transforms messages from client to runtime format. */
	private readonly _clientToRuntimeTransformer: DebugProtocolTransformer;

	/* Event emitted when a debug protocol message is sent to the client. */
	public readonly onDidSendMessage = this._onDidSendMessage.event;

	/* Event emitted when the runtime debugger state is refreshed. */
	public readonly onDidRefreshState = this._onDidRefreshState.event;

	constructor(
		options: RuntimeDebugAdapterOptions
	) {
		super();

		this._locationMapper = options.locationMapper;
		this._log = options.outputChannel;
		this._debugSession = options.debugSession;
		this._runtimeSession = options.runtimeSession;

		// Initialize transformers for converting between client and runtime debug protocol messages.
		this._runtimeToClientTransformer = new DebugProtocolTransformer({
			location: this._locationMapper.toClientLocation.bind(this._locationMapper)
		});
		this._clientToRuntimeTransformer = new DebugProtocolTransformer({
			location: this._locationMapper.toRuntimeLocation.bind(this._locationMapper),
		});

		// Forward debug messages from the runtime to the client.
		this._register(this._runtimeSession.onDidReceiveRuntimeMessage(async (runtimeMessage) => {
			switch (runtimeMessage.type) {
				case positron.LanguageRuntimeMessageType.DebugEvent:
					await this.handleRuntimeDebugEvent(runtimeMessage as positron.LanguageRuntimeDebugEvent);
					break;
				case positron.LanguageRuntimeMessageType.DebugReply:
					this.handleRuntimeDebugReply(runtimeMessage as positron.LanguageRuntimeDebugReply);
					break;
				// NOTE: language runtimes currently do not support receiving debug request messages.
			}
		}));
	}

	/* Handles debug events from the runtime. */
	private async handleRuntimeDebugEvent(event: positron.LanguageRuntimeDebugEvent): Promise<void> {
		const debugEvent = event.content as DebugProtocol.Event;

		// When the debugger is initialized, restore the debug state before forwarding to client.
		if (debugEvent.event === 'initialized') {
			await this.restoreState();
		}

		// Forward debug events to the client.
		this.sendMessage(debugEvent);
	}

	/* Handles debug replies from the runtime. */
	private handleRuntimeDebugReply(reply: positron.LanguageRuntimeDebugReply): void {
		const debugReply = reply.content as DebugProtocol.Response;

		// If this is a reply to one of our pending requests, send it to the client.
		if (this._pendingRequestIds.delete(reply.parent_id)) {
			this.sendMessage(debugReply);
		}
	}

	/* Restores debug state when reconnecting to a runtime. */
	private async restoreState(): Promise<void> {
		const debugInfo = await this.debugInfo();

		// TODO: We should update the UI when reconnecting to a runtime that's already debugging.

		// Notify listeners that the debug state has been refreshed.
		this._onDidRefreshState.fire(debugInfo);
	}

	/* Sends a debug message from runtime to client. */
	private sendMessage(runtimeMessage: DebugProtocol.ProtocolMessage): void {
		this._log.debug(`[runtime] >>> SEND ${formatDebugMessage(runtimeMessage)}`);
		const clientMessage = this.toClientMessage(runtimeMessage);
		this._log.debug(`[adapter] >>> SEND ${formatDebugMessage(clientMessage)}`);
		this._onDidSendMessage.fire(clientMessage);
	}

	/* Transforms a runtime message to client format. */
	private toClientMessage(runtimeMessage: DebugProtocol.ProtocolMessage): DebugProtocol.ProtocolMessage {
		try {
			return this._runtimeToClientTransformer.transform(runtimeMessage);
		} catch (error) {
			this._log.error(`[adapter] Error transforming message: ${formatDebugMessage(runtimeMessage as DebugProtocol.ProtocolMessage)}`, error);
		}
		return runtimeMessage;
	}

	/* Transforms a client message to runtime format. */
	private toRuntimeMessage(clientMessage: DebugProtocol.ProtocolMessage): DebugProtocol.ProtocolMessage {
		try {
			return this._clientToRuntimeTransformer.transform(clientMessage);
		} catch (error) {
			this._log.error(`[adapter] Error transforming message: ${formatDebugMessage(clientMessage)}`, error);
		}
		return clientMessage;
	}

	/* Handles incoming debug protocol messages from the client. */
	public handleMessage(clientMessage: DebugProtocol.ProtocolMessage): void {
		this._log.debug(`[adapter] <<< RECV ${formatDebugMessage(clientMessage)}`);

		// The Jupyter debug protocol currently only receives request messages.
		if (clientMessage.type !== 'request') {
			return;
		}

		const clientRequest = clientMessage as DebugProtocol.Request;
		this.handleMessageAsync(clientRequest).catch((error) => {
			this._log.error(`[adapter] Error handling message: ${formatDebugMessage(clientRequest)}`, error);
		});
	}

	private async handleMessageAsync(clientRequest: DebugProtocol.Request): Promise<void> {
		// Certain requests (e.g. setBreakpoints) require a plaintext source file rather than a custom file
		// format (e.g. ipynb). Try to create a source file in those cases.
		if (clientRequest.command === 'setBreakpoints') {
			const setBreakpointsRequest = clientRequest as DebugProtocol.SetBreakpointsRequest;
			if (setBreakpointsRequest.arguments.source.path) {
				await this.createSourceFile(setBreakpointsRequest.arguments.source.path);
			}
		}

		// Send the request to the runtime.
		const runtimeRequest = this.toRuntimeMessage(clientRequest) as DebugProtocol.Request;
		this._log.debug(`[runtime] <<< RECV ${formatDebugMessage(runtimeRequest)}`);
		const id = randomUUID();
		try {
			this._runtimeSession.debug(runtimeRequest, id);
		} catch (error) {
			if (clientRequest.command === 'initialize') {
				// Assume that the runtime does not support the Jupyter debug protocol.
				throw new Error(`Runtime does not support Jupyter debug protocol: ${formatDebugMessage(clientRequest)}`);
			}

			throw error;
		}
		this._pendingRequestIds.add(id);
	}

	/**
	 * Creates a source file for source code referenced in a client message, if needed.
	 *
	 * Certain requests (e.g. setBreakpoints) require a plaintext source file rather than a custom file
	 * format (e.g. ipynb). Runtimes that support the Jupyter debug protocol can create these source
	 * files via the custom `dumpCell` debug request.
	 */
	private async createSourceFile(clientSourcePath: string): Promise<void> {
		// Try to read the client source file from the workspace.
		const clientSourceUri = vscode.Uri.parse(clientSourcePath, true);
		const document = await vscode.workspace.openTextDocument(clientSourceUri);
		const code = document.getText();

		// Create the file in the runtime.
		await this.dumpCell(code);
	}

	/* Sends cell code to the debugger for source mapping. */
	private async dumpCell(code: string): Promise<DumpCellResponseBody> {
		return await this._debugSession.customRequest('dumpCell', { code } satisfies DumpCellArguments);
	}

	/* Retrieves debug configuration from the runtime. */
	private async debugInfo(): Promise<DebugInfoResponseBody> {
		return await this._debugSession.customRequest('debugInfo', {} satisfies DebugInfoArguments);
	}
}
