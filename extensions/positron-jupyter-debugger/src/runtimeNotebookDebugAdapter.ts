// /*---------------------------------------------------------------------------------------------
//  *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
//  *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
//  *--------------------------------------------------------------------------------------------*/

// import { DebugProtocol } from '@vscode/debugprotocol';
// import { randomUUID } from 'crypto';
// import * as positron from 'positron';
// import * as vscode from 'vscode';
// import { log } from './extension.js';
// import { murmurhash2_32 } from './murmur.js';
// import { DebugInfoResponseBody, DumpCellResponseBody, DumpCellArguments } from './types.js';
// import { DisposableStore, formatDebugMessage } from './util.js';
// import { RuntimeDebugAdapter } from './runtimeDebugAdapter.js';


// export class RuntimeNotebookDebugAdapter extends RuntimeDebugAdapter implements vscode.DebugAdapter, vscode.Disposable {
// 	private readonly _disposables = new DisposableStore();

// 	private readonly _onDidSendMessage = this._disposables.add(new vscode.EventEmitter<vscode.DebugProtocolMessage>());
// 	private readonly _onDidCompleteConfiguration = this._disposables.add(new vscode.EventEmitter<void>());

// 	public readonly onDidSendMessage = this._onDidSendMessage.event;
// 	public readonly onDidCompleteConfiguration = this._onDidCompleteConfiguration.event;

// 	private _cellUriByTempFilePath = new Map<string, string>();

// 	private sequence = 1;

// 	constructor(
// 		public readonly debugSession: vscode.DebugSession,
// 		public readonly runtimeSession: positron.LanguageRuntimeSession,
// 		public readonly notebook: vscode.NotebookDocument
// 	) {
// 		super(debugSession, runtimeSession);

// 		this.debugSession.customRequest('debugInfo').then((debugInfo: DebugInfoResponseBody) => {
// 			// TODO: Block debugging until this is done?
// 			// TODO: Update the map when a cell's source changes.
// 			for (const cell of this.notebook.getCells()) {
// 				const code = cell.document.getText();
// 				// TODO: Check hash method too.
// 				const id = murmurhash2_32(code, debugInfo.hashSeed);
// 				const tempFilePath = `${debugInfo.tmpFilePrefix}${id}${debugInfo.tmpFileSuffix}`;
// 				this._cellUriByTempFilePath.set(tempFilePath, cell.document.uri.toString());
// 			}
// 		});
// 	}

// 	private async handleSetBreakpointsRequest(request: DebugProtocol.SetBreakpointsRequest): Promise<void> {
// 		const cellUri = request.arguments.source.path;
// 		if (!cellUri) {
// 			throw new Error('No cell URI provided.');
// 		}
// 		const cell = this.notebook.getCells().find((cell) => cell.document.uri.toString() === cellUri);

// 		if (!cell) {
// 			this.emitClientMessage<DebugProtocol.SetBreakpointsResponse>({
// 				type: 'response',
// 				command: request.command,
// 				request_seq: request.seq,
// 				success: true,
// 				body: {
// 					breakpoints: request.arguments.breakpoints?.map((bp) => ({
// 						verified: false,
// 						line: bp.line,
// 						column: bp.column,
// 						message: `Unbound breakpoint`,
// 					})) ?? [],
// 				},
// 			});
// 			return;
// 		}

// 		// Dump the cell into a temp file.
// 		const dumpCellResponse = await this.dumpCell(cell);
// 		const kernelRequest = {
// 			...request,
// 			arguments: {
// 				...request.arguments,
// 				source: {
// 					...request.arguments.source,
// 					// name: `${request.arguments.source.name} (cell: ${cell.index})`,
// 					// // Editor should not try to retrieve this source.
// 					// // It doesn't exist in the debugger.
// 					// sourceReference: 0,
// 					path: dumpCellResponse.sourcePath,
// 				},
// 			},
// 		};
// 		const kernelResponse = await this.sendKernelRequest<
// 			DebugProtocol.SetBreakpointsRequest,
// 			DebugProtocol.SetBreakpointsResponse
// 		>(kernelRequest);
// 		const response = {
// 			...kernelResponse,
// 			body: {
// 				...kernelResponse.body,
// 				breakpoints: kernelResponse.body.breakpoints.map((breakpoint) => ({
// 					...breakpoint,
// 					source: (breakpoint.source?.path && this._cellUriByTempFilePath.has(breakpoint.source.path)) ?
// 						// TODO: Can we use source from above: request.arguments.source?
// 						{
// 							sourceReference: 0, // Editor should not try to retrieve this source since its a known cell URI.
// 							path: this._cellUriByTempFilePath.get(breakpoint.source.path),
// 							// TODO: Error in this case?
// 						} : breakpoint.source,
// 				})),
// 			},
// 		};
// 		this.emitClientMessage(response);
// 	}

// 	private async handleStackTraceRequest(request: DebugProtocol.StackTraceRequest): Promise<void> {
// 		const kernelResponse = await this.sendKernelRequest<
// 			DebugProtocol.StackTraceRequest,
// 			DebugProtocol.StackTraceResponse
// 		>(request);
// 		const response: DebugProtocol.StackTraceResponse = {
// 			...kernelResponse,
// 			body: {
// 				...kernelResponse.body,
// 				stackFrames: kernelResponse.body.stackFrames.map((frame) => ({
// 					...frame,
// 					source: (frame.source?.path && this._cellUriByTempFilePath.has(frame.source.path)) ?
// 						// TODO: Can we use source from above: request.arguments.source?
// 						{
// 							sourceReference: 0, // Editor should not try to retrieve this source since its a known cell URI.
// 							path: this._cellUriByTempFilePath.get(frame.source.path),
// 							// TODO: Error in this case?
// 						} : frame.source,
// 				})),
// 			},
// 		};
// 		this.emitClientMessage(response);
// 	}

// 	private async dumpCell(cell: vscode.NotebookCell): Promise<DumpCellResponseBody> {
// 		const response = await this.debugSession.customRequest(
// 			'dumpCell',
// 			{ code: cell.document.getText() } satisfies DumpCellArguments
// 		) as DumpCellResponseBody;

// 		// TODO: Do these need to be cleared?...
// 		this._cellUriByTempFilePath.set(response.sourcePath, cell.document.uri.toString());

// 		return response;
// 	}

// 	// private async stackTrace(
// 	//     args: DebugProtocol.StackTraceArguments,
// 	// ): Promise<DebugProtocol.StackTraceResponse['body']> {
// 	//     return await this._debugSession.customRequest('stackTrace', args);
// 	// }
// 	// private async stepIn(args: DebugProtocol.StepInArguments): Promise<DebugProtocol.StepInResponse['body']> {
// 	//     return await this._debugSession.customRequest('stepIn', args);
// 	// }
// 	private emitClientMessage<P extends DebugProtocol.ProtocolMessage>(message: Omit<P, 'seq'>): void {
// 		const emittedMessage: DebugProtocol.ProtocolMessage = {
// 			...message,
// 			seq: this.sequence,
// 		};

// 		if (emittedMessage.type === 'response' &&
// 			(emittedMessage as DebugProtocol.Response).command === 'configurationDone') {
// 			this._onDidCompleteConfiguration.fire();
// 		}

// 		this.sequence++;
// 		log.debug(`[adapter] >>> SEND ${formatDebugMessage(emittedMessage)}`);
// 		this._onDidSendMessage.fire(emittedMessage);
// 	}

// 	private async sendKernelRequest<P extends DebugProtocol.Request, R extends DebugProtocol.Response>(
// 		request: P
// 	): Promise<R> {
// 		const id = randomUUID();

// 		// TODO: Timeout?
// 		const responsePromise = new Promise<R>((resolve, reject) => {
// 			const disposable = this.runtimeSession.onDidReceiveRuntimeMessage((message) => {
// 				if (message.parent_id !== id) {
// 					return;
// 				}
// 				if (message.type === positron.LanguageRuntimeMessageType.DebugReply) {
// 					const debugReply = message as positron.LanguageRuntimeDebugReply;
// 					if (debugReply.content === undefined) {
// 						reject(new Error('No content in debug reply. Is debugpy already listening?'));
// 					}
// 					log.debug(`[kernel] >>> SEND ${formatDebugMessage(debugReply.content)}`);
// 					resolve(debugReply.content as R);
// 					disposable.dispose();
// 				}
// 			});
// 		});

// 		log.debug(`[kernel] <<< RECV ${formatDebugMessage(request)}`);
// 		this.runtimeSession.debug(request, id);

// 		const response = await responsePromise;
// 		return response;
// 	}

// 	public dispose() {
// 		this._disposables.dispose();
// 	}
// }
