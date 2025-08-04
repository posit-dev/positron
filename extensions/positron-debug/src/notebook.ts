/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';
import { log } from './extension.js';
import { murmurhash2_32 } from './murmur.js';
import { randomUUID } from 'crypto';
import { DisposableStore, formatDebugMessage } from './util.js';
import { DebugInfoResponseBody, DumpCellArguments, DumpCellResponseBody } from './types.js';
import { Command } from './constants.js';

class RuntimeNotebookDebugAdapter implements vscode.DebugAdapter, vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];

	private readonly _onDidSendMessage = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
	private readonly _onDidCompleteConfiguration = new vscode.EventEmitter<void>();

	public readonly onDidSendMessage = this._onDidSendMessage.event;
	public readonly onDidCompleteConfiguration = this._onDidCompleteConfiguration.event;

	private _cellUriByTempFilePath = new Map<string, string>();

	private sequence = 1;

	constructor(
		public readonly debugSession: vscode.DebugSession,
		public readonly runtimeSession: positron.LanguageRuntimeSession,
		public readonly notebook: vscode.NotebookDocument,
	) {
		this._disposables.push(this._onDidSendMessage, this._onDidCompleteConfiguration);

		this._disposables.push(
			this.runtimeSession.onDidReceiveRuntimeMessage(async (message) => {
				// TODO: Could the event be for another debug session?
				if (message.type === positron.LanguageRuntimeMessageType.DebugEvent) {
					const debugEvent = message as positron.LanguageRuntimeDebugEvent;
					log.debug(`[kernel] >>> SEND ${formatDebugMessage(debugEvent.content)}`);

					// TODO: Do we need this?
					// Only handle stopped events inside the cell.
					// Otherwise the debugger stops in internal IPython/ipykernel code.
					// if (debugEvent.content.event === 'stopped') {
					//     const stoppedEvent = debugEvent.content as DebugProtocol.StoppedEvent;
					//     const threadId = stoppedEvent.body.threadId;
					//     if (threadId) {
					//         // Call stackTrace to determine whether to forward the stop event to the client, and also to
					//         // start the process of updating the variables view.
					//         const stackTraceResponse = await this.stackTrace({
					//             threadId,
					//             startFrame: 0,
					//             levels: 1,
					//         });
					//         const stackFrame = stackTraceResponse.stackFrames[0];
					//         // NOTE: This path will be a cell URI since it uses customRequest thus
					//         //       goes through the adapter transformations.
					//         if (stackFrame.source?.path !== this._cell.document.uri.toString()) {
					//             // TODO: Why do we step in?...
					//             log.debug('Intercepting stopped event for non-cell source; stepping in');
					//             // TODO: Could this be 'next'?
					//             // Run in the background to avoid being very slow?
					//             // this.sendRequest<DebugProtocol.StepInRequest, DebugProtocol.StepInResponse>({
					//             //     command: 'stepIn',
					//             //     arguments: {
					//             //         threadId,
					//             //     },
					//             // }).ignoreErrors();

					//             this.stepIn({ threadId }).ignoreErrors();
					//             return;
					//         }
					//     }
					// }

					this.emitClientMessage(debugEvent.content);
				}
			}),
		);

		this.debugSession.customRequest('debugInfo').then((debugInfo: DebugInfoResponseBody) => {
			// TODO: Block debugging until this is done?
			// TODO: Update the map when a cell's source changes.
			for (const cell of this.notebook.getCells()) {
				const code = cell.document.getText();
				// TODO: Check hash method too.
				const id = murmurhash2_32(code, debugInfo.hashSeed);
				const tempFilePath = `${debugInfo.tmpFilePrefix}${id}${debugInfo.tmpFileSuffix}`;
				this._cellUriByTempFilePath.set(tempFilePath, cell.document.uri.toString());
			}
		});
	}

	public get notebookUri(): vscode.Uri {
		return this.notebook.uri;
	}

	public handleMessage(message: DebugProtocol.ProtocolMessage): void {
		this.handleMessageAsync(message).catch((error) => {
			log.error(`[adapter] Error handling message: ${formatDebugMessage(message)}`, error);
			// TODO: should still respond with an error response...
		});
	}

	private async handleMessageAsync(message: DebugProtocol.ProtocolMessage): Promise<void> {
		log.debug(`[adapter] <<< RECV ${formatDebugMessage(message)}`);
		switch (message.type) {
			case 'request':
				return await this.handleRequest(message as DebugProtocol.Request);
		}
	}

	private async handleRequest(request: DebugProtocol.Request): Promise<void> {
		switch (request.command) {
			case 'setBreakpoints':
				return await this.handleSetBreakpointsRequest(request as DebugProtocol.SetBreakpointsRequest);
			case 'stackTrace':
				return await this.handleStackTraceRequest(request as DebugProtocol.StackTraceRequest);
		}
		const response = await this.sendKernelRequest(request);
		this.emitClientMessage(response);
	}

	private async handleSetBreakpointsRequest(request: DebugProtocol.SetBreakpointsRequest): Promise<void> {
		const cellUri = request.arguments.source.path;
		if (!cellUri) {
			throw new Error('No cell URI provided.');
		}
		const cell = this.notebook.getCells().find((cell) => cell.document.uri.toString() === cellUri);

		if (!cell) {
			this.emitClientMessage<DebugProtocol.SetBreakpointsResponse>({
				type: 'response',
				command: request.command,
				request_seq: request.seq,
				success: true,
				body: {
					breakpoints:
						request.arguments.breakpoints?.map((bp) => ({
							verified: false,
							line: bp.line,
							column: bp.column,
							message: `Unbound breakpoint`,
						})) ?? [],
				},
			});
			return;
		}

		// Dump the cell into a temp file.
		const dumpCellResponse = await this.dumpCell(cell);
		const kernelRequest = {
			...request,
			arguments: {
				...request.arguments,
				source: {
					...request.arguments.source,
					// name: `${request.arguments.source.name} (cell: ${cell.index})`,
					// // Editor should not try to retrieve this source.
					// // It doesn't exist in the debugger.
					// sourceReference: 0,
					path: dumpCellResponse.sourcePath,
				},
			},
		};
		const kernelResponse = await this.sendKernelRequest<
			DebugProtocol.SetBreakpointsRequest,
			DebugProtocol.SetBreakpointsResponse
		>(kernelRequest);
		const response = {
			...kernelResponse,
			body: {
				...kernelResponse.body,
				breakpoints: kernelResponse.body.breakpoints.map((breakpoint) => ({
					...breakpoint,
					source: (breakpoint.source?.path && this._cellUriByTempFilePath.has(breakpoint.source.path)) ?
						// TODO: Can we use source from above: request.arguments.source?
						{
							sourceReference: 0, // Editor should not try to retrieve this source since its a known cell URI.
							path: this._cellUriByTempFilePath.get(breakpoint.source.path),
							// TODO: Error in this case?
						} : breakpoint.source,
				})),
			},
		};
		this.emitClientMessage(response);
	}

	private async handleStackTraceRequest(request: DebugProtocol.StackTraceRequest): Promise<void> {
		const kernelResponse = await this.sendKernelRequest<
			DebugProtocol.StackTraceRequest,
			DebugProtocol.StackTraceResponse
		>(request);
		const response: DebugProtocol.StackTraceResponse = {
			...kernelResponse,
			body: {
				...kernelResponse.body,
				stackFrames: kernelResponse.body.stackFrames.map((frame) => ({
					...frame,
					source: (frame.source?.path && this._cellUriByTempFilePath.has(frame.source.path)) ?
						// TODO: Can we use source from above: request.arguments.source?
						{
							sourceReference: 0, // Editor should not try to retrieve this source since its a known cell URI.
							path: this._cellUriByTempFilePath.get(frame.source.path),
							// TODO: Error in this case?
						} : frame.source,
				})),
			},
		};
		this.emitClientMessage(response);
	}

	private async dumpCell(cell: vscode.NotebookCell): Promise<DumpCellResponseBody> {
		const response = await this.debugSession.customRequest(
			'dumpCell',
			{ code: cell.document.getText() } satisfies DumpCellArguments,
		) as DumpCellResponseBody;

		// TODO: Do these need to be cleared?...
		this._cellUriByTempFilePath.set(response.sourcePath, cell.document.uri.toString());

		return response;
	}

	// private async stackTrace(
	//     args: DebugProtocol.StackTraceArguments,
	// ): Promise<DebugProtocol.StackTraceResponse['body']> {
	//     return await this._debugSession.customRequest('stackTrace', args);
	// }

	// private async stepIn(args: DebugProtocol.StepInArguments): Promise<DebugProtocol.StepInResponse['body']> {
	//     return await this._debugSession.customRequest('stepIn', args);
	// }

	private emitClientMessage<P extends DebugProtocol.ProtocolMessage>(message: Omit<P, 'seq'>): void {
		const emittedMessage: DebugProtocol.ProtocolMessage = {
			...message,
			seq: this.sequence,
		};

		if (
			emittedMessage.type === 'response' &&
			(emittedMessage as DebugProtocol.Response).command === 'configurationDone'
		) {
			this._onDidCompleteConfiguration.fire();
		}

		this.sequence++;
		log.debug(`[adapter] >>> SEND ${formatDebugMessage(emittedMessage)}`);
		this._onDidSendMessage.fire(emittedMessage);
	}

	private async sendKernelRequest<P extends DebugProtocol.Request, R extends DebugProtocol.Response>(
		request: P,
	): Promise<R> {
		const id = randomUUID();

		// TODO: Timeout?
		const responsePromise = new Promise<R>((resolve, reject) => {
			const disposable = this.runtimeSession.onDidReceiveRuntimeMessage((message) => {
				if (message.parent_id !== id) {
					return;
				}
				if (message.type === positron.LanguageRuntimeMessageType.DebugReply) {
					const debugReply = message as positron.LanguageRuntimeDebugReply;
					if (debugReply.content === undefined) {
						reject(new Error('No content in debug reply. Is debugpy already listening?'));
					}
					log.debug(`[kernel] >>> SEND ${formatDebugMessage(debugReply.content)}`);
					resolve(debugReply.content as R);
					disposable.dispose();
				}
			});
		});

		log.debug(`[kernel] <<< RECV ${formatDebugMessage(request)}`);
		this.runtimeSession.debug(request, id);

		const response = await responsePromise;
		return response;
	}

	public dispose() {
		this._disposables.forEach((disposable) => disposable.dispose());
	}
}

class DebugCellManager implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];

	private _executionId?: string;

	constructor(
		private readonly _adapter: RuntimeNotebookDebugAdapter,
		private readonly _debugSession: vscode.DebugSession,
		private readonly _notebook: vscode.NotebookDocument,
		private readonly _runtimeSession: positron.LanguageRuntimeSession,
		private readonly _cellIndex: number,
	) {
		// TODO: Check that the cell belongs to the notebook? Or pass in cell index?

		// Execute the cell when the debug session is ready.
		// TODO: If we attach to an existing debug session, would this work?
		//       Or we could also track configuration completed state in an adapter property
		const configDisposable = this._adapter.onDidCompleteConfiguration(async () => {
			configDisposable.dispose();

			// TODO: Is this right? Should we dump all cells?
			//       We have to at least dump this cell so that if a called function in another cell has a breakpoint,
			//       this cell can still be referenced e.g. in the stack trace.
			// TODO: Take cell as arg?
			// const cell = this._notebook.cellAt(this._cellIndex);
			// this._adapter.dumpCell(cell).catch((error) => {
			// 	log.error(`Error dumping cell ${cell.index}:`, error);
			// });

			// TODO: Can this throw?
			await vscode.commands.executeCommand('notebook.cell.execute', {
				ranges: [{ start: this._cellIndex, end: this._cellIndex + 1 }],
				document: this._notebook.uri,
			});
		});
		this._disposables.push(configDisposable);

		// Track the runtime execution ID when the cell is executed.
		const executeDisposable = positron.runtime.onDidExecuteCode((event) => {
			// TODO: restrict to cell and session ID as well?
			if (
				event.attribution.source === positron.CodeAttributionSource.Notebook &&
				// TODO: what does this look like for untitled/unsaved files?
				event.attribution.metadata?.notebook === this._notebook.uri.fsPath
			) {
				executeDisposable.dispose();
				this._executionId = event.executionId;
			}
		});
		this._disposables.push(executeDisposable);

		// End the debug session when the cell execution is complete.
		const messageDisposable = this._runtimeSession.onDidReceiveRuntimeMessage(async (message) => {
			// TODO: Throw or wait if execution ID is not set?
			if (
				this._executionId &&
				message.parent_id === this._executionId &&
				message.type === positron.LanguageRuntimeMessageType.State &&
				(message as positron.LanguageRuntimeState).state === positron.RuntimeOnlineState.Idle
			) {
				messageDisposable.dispose();
				await vscode.debug.stopDebugging(this._debugSession);
				// TODO: this.dispose()? Or ensure its disposed elsewhere?
			}
		});
		this._disposables.push(messageDisposable);
	}

	dispose() {
		this._disposables.forEach((disposable) => disposable.dispose());
	}
}

// TODO: How do we handle reusing a debug adapter/session across cells?
class RuntimeNotebookDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory, vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];

	async createDebugAdapterDescriptor(debugSession: vscode.DebugSession, _executable: vscode.DebugAdapterExecutable) {
		const notebook = vscode.workspace.notebookDocuments.find(
			(doc) => doc.uri.toString() === debugSession.configuration.__notebookUri,
		);
		if (!notebook) {
			return undefined;
		}

		const cell = debugSession.configuration.__cellIndex &&
			notebook.cellAt(debugSession.configuration.__cellIndex);
		if (!cell) {
			return undefined;
		}

		// TODO: A given runtime session can only have one debug session at a time...

		const runtimeSessions = await positron.runtime.getActiveSessions();
		const runtimeSession = runtimeSessions.find(
			(session) => session.metadata.notebookUri &&
				session.metadata.notebookUri.toString() === debugSession.configuration.__notebookUri,
		);
		if (!runtimeSession) {
			log.warn(`No runtime session found for notebook: ${notebook.uri}`);
			return undefined;
		}
		// TODO: Remove
		// const runtimeSession = await positron.runtime.getNotebookSession(notebook.uri);
		// if (!runtimeSession) {
		// 	return undefined;
		// }

		// Create a new debug adapter for the notebook.
		// TODO: Reuse adapter if it already exists for the notebook?
		const adapter = new RuntimeNotebookDebugAdapter(debugSession, runtimeSession, notebook);
		this._disposables.push(adapter);

		// Create a debug cell manager to handle the cell execution and debugging.
		const debugCellManager = new DebugCellManager(adapter, debugSession, notebook, runtimeSession, cell.index);
		this._disposables.push(debugCellManager);

		// End the debug session when the kernel is interrupted.
		const stateDisposable = runtimeSession.onDidChangeRuntimeState(async (state) => {
			console.log(`Runtime state changed: ${state}`);
			if (state === positron.RuntimeState.Interrupting) {
				stateDisposable.dispose();
				await vscode.debug.stopDebugging(debugSession);
			}
		});
		this._disposables.push(stateDisposable);

		// Clean up when the debug session terminates.
		this._disposables.push(
			vscode.debug.onDidTerminateDebugSession((session) => {
				if (session.id === debugSession.id) {
					stateDisposable.dispose();
					debugCellManager.dispose();
					adapter.dispose();
				}
			}),
		);

		return new vscode.DebugAdapterInlineImplementation(adapter);
	}

	dispose() {
		this._disposables.forEach((disposable) => disposable.dispose());
	}
}

export function activateRuntimeNotebookDebugging(): vscode.Disposable {
	const disposables = new DisposableStore();

	const adapterFactory = disposables.add(new RuntimeNotebookDebugAdapterFactory());
	disposables.add(vscode.debug.registerDebugAdapterDescriptorFactory('notebook', adapterFactory));

	disposables.add(vscode.commands.registerCommand(Command.DebugCell, debugCell));

	return disposables;
}

/**
 * Debug a notebook cell.
 *
 * @param cell The notebook cell to debug. If undefined, the active cell will be used.
 */
async function debugCell(cell: vscode.NotebookCell | undefined): Promise<void> {
	// This command can be called from:
	// 1. A cell's execute menu (`cell` is defined).
	// 2. The command palette (`cell` is undefined).

	// If no cell is provided, use the selected cell.
	if (!cell) {
		cell = getActiveNotebookCell();

		// If no cell is selected, log a warning and return.
		if (!cell) {
			// TODO: Should we show a notification instead?
			log.warn(`${Command.DebugCell} command called without a cell.`);
			return;
		}
	}

	// Start a debug session for the cell.
	// This will, in turn, create a debug adapter for the notebook using the factory defined above.
	await vscode.debug.startDebugging(undefined, {
		type: 'runtimeNotebook',
		name: path.basename(cell.notebook.uri.fsPath),
		request: 'attach',
		// TODO: Get from config.
		justMyCode: true,
		__notebookUri: cell.notebook.uri.toString(),
		__cellIndex: cell.index,
	});
}

/** Get the active notebook cell, if one exists. */
function getActiveNotebookCell(): vscode.NotebookCell | undefined {
	const editor = vscode.window.activeNotebookEditor;
	if (editor) {
		const range = editor.selections[0];
		if (range) {
			return editor.notebook.cellAt(range.start);
		}
	}
	return undefined;
}
