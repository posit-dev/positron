/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { randomUUID } from 'crypto';

const log = vscode.window.createOutputChannel('Debug', { log: true });

interface DumpCellArguments {
    code: string;
}

interface DumpCellResponseBody {
    sourcePath: string;
}

function logMessage(message: DebugProtocol.ProtocolMessage) {
    switch (message.type) {
        case 'request': {
            const request = message as DebugProtocol.Request;
            return `${request.command} #${request.seq}: ${JSON.stringify(request.arguments)}`;
        }
        case 'event': {
            const event = message as DebugProtocol.Event;
            return `${event.event}: ${JSON.stringify(event.body)}`;
        }
        case 'response': {
            const response = message as DebugProtocol.Response;
            return `${response.command} #${response.request_seq}: ${JSON.stringify(response.body)}`;
        }
        default: {
            return `[${message.type}]: ${JSON.stringify(message)}`;
        }
    }
}

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
                    log.debug(`[kernel] >>> SEND ${logMessage(debugEvent.content)}`);

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
    }

    public get notebookUri(): vscode.Uri {
        return this.notebook.uri;
    }

    public handleMessage(message: DebugProtocol.ProtocolMessage): void {
        this.handleMessageAsync(message).catch((error) => {
            log.error(`[adapter] Error handling message: ${logMessage(message)}`, error);
            // TODO: should still respond with an error response...
        });
    }

    private async handleMessageAsync(message: DebugProtocol.ProtocolMessage): Promise<void> {
        log.debug(`[adapter] <<< RECV ${logMessage(message)}`);
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

        const code = cell.document.getText();
        // Dump the cell into a temp file.
        const dumpCellResponse = await this.dumpCell({ code });
        const path = dumpCellResponse.sourcePath;
        // TODO: Do these need to be cleared?...
        this._cellUriByTempFilePath.set(path, cellUri);
        const kernelRequest = {
            ...request,
            arguments: {
                ...request.arguments,
                source: {
                    ...request.arguments.source,
                    path,
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
                    source: {
                        ...breakpoint.source,
                        // Swap the source path with the original cell path.
                        path:
                            (breakpoint.source?.path && this._cellUriByTempFilePath.get(breakpoint.source.path)) ??
                            breakpoint.source?.path,
                    },
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
                    source: {
                        ...frame.source,
                        path:
                            (frame.source?.path && this._cellUriByTempFilePath.get(frame.source.path)) ??
                            frame.source?.path,
                    },
                })),
            },
        };
        this.emitClientMessage(response);
    }

    private async dumpCell(args: DumpCellArguments): Promise<DumpCellResponseBody> {
        return await this.debugSession.customRequest('dumpCell', args);
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
        log.debug(`[adapter] >>> SEND ${logMessage(emittedMessage)}`);
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
                    log.debug(`[kernel] >>> SEND ${logMessage(debugReply.content)}`);
                    resolve(debugReply.content as R);
                    disposable.dispose();
                }
            });
        });

        log.debug(`[kernel] <<< RECV ${logMessage(request)}`);
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

        const cell = notebook
            .getCells()
            .find((cell) => cell.document.uri.toString() === debugSession.configuration.__cellUri);
        if (!cell) {
            return undefined;
        }

        // TODO: A given runtime session can only have one debug session at a time...

        const runtimeSession = await positron.runtime.getNotebookSession(notebook.uri);
        if (!runtimeSession) {
            return undefined;
        }

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

export function activateRuntimeNotebookDebugging(disposables: vscode.Disposable[]) {
    const adapterFactory = new RuntimeNotebookDebugAdapterFactory();
    disposables.push(adapterFactory);
    disposables.push(vscode.debug.registerDebugAdapterDescriptorFactory('runtimeNotebook', adapterFactory));

    disposables.push(
        vscode.commands.registerCommand('python.runAndDebugCell', async () => {
            const notebookEditor = vscode.window.activeNotebookEditor;
            if (!notebookEditor) {
                return;
            }

            const cellUri = vscode.window.activeTextEditor?.document.uri;
            if (!cellUri) {
                return;
            }

            await vscode.debug.startDebugging(undefined, {
                type: 'runtimeNotebook',
                name: path.basename(notebookEditor.notebook.uri.fsPath),
                request: 'attach',
                // TODO: Get from config.
                justMyCode: false,
                __notebookUri: notebookEditor.notebook.uri.toString(),
                __cellUri: cellUri.toString(),
            });
        }),
    );
}
