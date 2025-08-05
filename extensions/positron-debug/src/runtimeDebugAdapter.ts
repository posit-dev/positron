/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DebugProtocol } from '@vscode/debugprotocol';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { DumpCellResponseBody, DumpCellArguments } from './types.js';
import { DisposableStore, formatDebugMessage } from './util.js';
import { performRuntimeDebugRPC } from './runtime.js';

// interface NextSignature<P, R> {
// 	(this: void, data: P, next: (data: P) => R): R;
// }

// interface Middleware {
// 	handleSetBreakpointsRequest?: NextSignature<DebugProtocol.SetBreakpointsRequest, Promise<DebugProtocol.SetBreakpointsResponse>>;
// 	handleStackTraceRequest?: NextSignature<DebugProtocol.StackTraceRequest, Promise<DebugProtocol.StackTraceResponse>>;
// }

export class RuntimeDebugAdapter implements vscode.DebugAdapter, vscode.Disposable {
	private readonly _disposables = new DisposableStore();
	private readonly _onDidSendMessage = this._disposables.add(new vscode.EventEmitter<vscode.DebugProtocolMessage>());
	private readonly _onDidCompleteConfiguration = this._disposables.add(new vscode.EventEmitter<void>());
	private _cellUriByTempFilePath = new Map<string, string>();
	private sequence = 1;

	/** Event emitted when a debug protocol message is sent to the client. */
	public readonly onDidSendMessage = this._onDidSendMessage.event;

	/** Event emitted when the debugger has completed its configuration. */
	public readonly onDidCompleteConfiguration = this._onDidCompleteConfiguration.event;

	constructor(
		private readonly _log: vscode.LogOutputChannel,
		public readonly debugSession: vscode.DebugSession,
		public readonly runtimeSession: positron.LanguageRuntimeSession,
	) {
		// Forward debug events from the runtime session to the client.
		this._disposables.add(this.runtimeSession.onDidReceiveRuntimeMessage(async (message) => {
			// TODO: Could the event be for another debug session?
			if (message.type === positron.LanguageRuntimeMessageType.DebugEvent) {
				const debugEvent = message as positron.LanguageRuntimeDebugEvent;
				this._log.debug(`[runtime] >>> SEND ${formatDebugMessage(debugEvent.content)}`);
				this.emitClientMessage(debugEvent.content);
			}
		}));
	}

	public handleMessage(message: DebugProtocol.ProtocolMessage): void {
		this.handleMessageAsync(message).catch((error) => {
			this._log.error(`[adapter] Error handling message: ${formatDebugMessage(message)}`, error);
			// TODO: should still respond with an error response...
		});
	}

	private async handleMessageAsync(message: DebugProtocol.ProtocolMessage): Promise<void> {
		this._log.debug(`[adapter] <<< RECV ${formatDebugMessage(message)}`);
		switch (message.type) {
			case 'request':
				return await this.handleRequest(message as DebugProtocol.Request);
		}
		// TODO: Don't we need to handle events and responses too?
	}

	private async handleRequest(request: DebugProtocol.Request): Promise<void> {
		// switch (request.command) {
		// 	case 'setBreakpoints':
		// 		return await this.handleSetBreakpointsRequest(request as DebugProtocol.SetBreakpointsRequest);
		// 	case 'stackTrace':
		// 		return await this.handleStackTraceRequest(request as DebugProtocol.StackTraceRequest);
		// }
		const response = await this.performRuntimeDebugRPC(request);
		this.emitClientMessage(response);
	}

	// private async handleSetBreakpointsRequest(request: DebugProtocol.SetBreakpointsRequest): Promise<void> {
	// 	const cellUri = request.arguments.source.path;
	// 	if (!cellUri) {
	// 		throw new Error('No cell URI provided.');
	// 	}
	// 	const cell = this.notebook.getCells().find((cell) => cell.document.uri.toString() === cellUri);

	// 	// TODO: Abstract source mapping...
	// 	//       i.e. client request.arguments.source.path (cell URI, console history item URI?)
	// 	//            -> kernel temp file path

	// 	if (!cell) {
	// 		this.emitClientMessage<DebugProtocol.SetBreakpointsResponse>({
	// 			type: 'response',
	// 			command: request.command,
	// 			request_seq: request.seq,
	// 			success: true,
	// 			body: {
	// 				breakpoints: request.arguments.breakpoints?.map((bp) => ({
	// 					verified: false,
	// 					line: bp.line,
	// 					column: bp.column,
	// 					message: `Unbound breakpoint`,
	// 				})) ?? [],
	// 			},
	// 		});
	// 		return;
	// 	}

	// 	// Dump the cell into a temp file.
	// 	const dumpCellResponse = await this.dumpCell(cell);
	// 	const runtimeRequest = {
	// 		...request,
	// 		arguments: {
	// 			...request.arguments,
	// 			source: {
	// 				...request.arguments.source,
	// 				// name: `${request.arguments.source.name} (cell: ${cell.index})`,
	// 				// // Editor should not try to retrieve this source.
	// 				// // It doesn't exist in the debugger.
	// 				// sourceReference: 0,
	// 				path: dumpCellResponse.sourcePath,
	// 			},
	// 		},
	// 	};
	// 	const runtimeResponse = await this.performRuntimeDebugRPC<
	// 		DebugProtocol.SetBreakpointsRequest,
	// 		DebugProtocol.SetBreakpointsResponse
	// 	>(runtimeRequest);
	// 	const response = {
	// 		...runtimeResponse,
	// 		body: {
	// 			...runtimeResponse.body,
	// 			breakpoints: runtimeResponse.body.breakpoints.map((breakpoint) => ({
	// 				...breakpoint,
	// 				source: (breakpoint.source?.path && this._cellUriByTempFilePath.has(breakpoint.source.path)) ?
	// 					// TODO: Can we use source from above: request.arguments.source?
	// 					{
	// 						sourceReference: 0, // Editor should not try to retrieve this source since its a known cell URI.
	// 						path: this._cellUriByTempFilePath.get(breakpoint.source.path),
	// 						// TODO: Error in this case?
	// 					} : breakpoint.source,
	// 			})),
	// 		},
	// 	};
	// 	this.emitClientMessage(response);
	// }

	// private async handleStackTraceRequest(request: DebugProtocol.StackTraceRequest): Promise<void> {
	// 	const runtimeResponse = await this.performRuntimeDebugRPC<
	// 		DebugProtocol.StackTraceRequest,
	// 		DebugProtocol.StackTraceResponse
	// 	>(request);
	// 	const response: DebugProtocol.StackTraceResponse = {
	// 		...runtimeResponse,
	// 		body: {
	// 			...runtimeResponse.body,
	// 			stackFrames: runtimeResponse.body.stackFrames.map((frame) => ({
	// 				...frame,
	// 				source: (frame.source?.path && this._cellUriByTempFilePath.has(frame.source.path)) ?
	// 					// TODO: Can we use source from above: request.arguments.source?
	// 					{
	// 						sourceReference: 0, // Editor should not try to retrieve this source since its a known cell URI.
	// 						path: this._cellUriByTempFilePath.get(frame.source.path),
	// 						// TODO: Error in this case?
	// 					} : frame.source,
	// 			})),
	// 		},
	// 	};
	// 	this.emitClientMessage(response);
	// }

	public async dumpCell(code: string): Promise<DumpCellResponseBody> {
		return await this.debugSession.customRequest(
			'dumpCell',
			{ code } satisfies DumpCellArguments
		) as DumpCellResponseBody;
	}

	// private async stackTrace(
	//     args: DebugProtocol.StackTraceArguments,
	// ): Promise<DebugProtocol.StackTraceResponse['body']> {
	//     return await this._debugSession.customRequest('stackTrace', args);
	// }

	// private async stepIn(args: DebugProtocol.StepInArguments): Promise<DebugProtocol.StepInResponse['body']> {
	//     return await this._debugSession.customRequest('stepIn', args);
	// }

	private async performRuntimeDebugRPC<Req extends DebugProtocol.Request, Res extends DebugProtocol.Response>(
		request: Req
	): Promise<Res> {
		this._log.debug(`[runtime] <<< RECV ${formatDebugMessage(request)}`);
		const response = await performRuntimeDebugRPC<Req, Res>(request, this.runtimeSession, this._disposables);
		this._log.debug(`[runtime] >>> SEND ${formatDebugMessage(response)}`);
		return response;
	}

	private emitClientMessage<P extends DebugProtocol.ProtocolMessage>(message: Omit<P, 'seq'>): void {
		const emittedMessage: DebugProtocol.ProtocolMessage = {
			...message,
			seq: this.sequence,
		};

		if (emittedMessage.type === 'response' &&
			(emittedMessage as DebugProtocol.Response).command === 'configurationDone') {
			this._onDidCompleteConfiguration.fire();
		}

		this.sequence++;
		this._log.debug(`[adapter] >>> SEND ${formatDebugMessage(emittedMessage)}`);
		this._onDidSendMessage.fire(emittedMessage);
	}

	public dispose() {
		this._disposables.dispose();
	}
}
