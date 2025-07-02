/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { randomUUID } from 'crypto';
import { IDisposableRegistry, IInstaller, InstallerResponse, Product } from '../common/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IServiceContainer } from '../ioc/types';
import { traceError, traceInfo } from '../logging';
import { MINIMUM_PYTHON_VERSION, Commands } from '../common/constants';
import { getIpykernelBundle } from './ipykernel';
import { InstallOptions } from '../common/installer/types';
import { activateAppDetection as activateWebAppDetection } from './webAppContexts';
import { activateWebAppCommands } from './webAppCommands';
import { activateWalkthroughCommands } from './walkthroughCommands';
import { printInterpreterDebugInfo } from './interpreterSettings';
import { registerLanguageServerManager } from './languageServerManager';

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

class PythonNotebookDebugAdapter implements vscode.DebugAdapter {
    private readonly _disposables: vscode.Disposable[] = [];

    private readonly _onDidSendMessage = new vscode.EventEmitter<vscode.DebugProtocolMessage>();

    public readonly onDidSendMessage = this._onDidSendMessage.event;

    private _cellUriByTempFilePath = new Map<string, string>();

    private sequence = 1;

    constructor(
        private readonly _debugSession: vscode.DebugSession,
        private readonly _runtimeSession: positron.LanguageRuntimeSession,
        private readonly _notebook: vscode.NotebookDocument,
    ) {
        this._disposables.push(this._onDidSendMessage);

        this._disposables.push(
            this._runtimeSession.onDidReceiveRuntimeMessage(async (message) => {
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
        const cell = this._notebook.getCells().find((cell) => cell.document.uri.toString() === cellUri);

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
        return await this._debugSession.customRequest('dumpCell', args);
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
        const messageWithSeq: DebugProtocol.ProtocolMessage = {
            ...message,
            seq: this.sequence,
        };
        this.sequence++;
        log.debug(`[adapter] >>> SEND ${logMessage(messageWithSeq)}`);
        this._onDidSendMessage.fire(messageWithSeq);
    }

    private async sendKernelRequest<P extends DebugProtocol.Request, R extends DebugProtocol.Response>(
        request: P,
    ): Promise<R> {
        const id = randomUUID();

        // TODO: Timeout?
        const responsePromise = new Promise<R>((resolve, reject) => {
            const disposable = this._runtimeSession.onDidReceiveRuntimeMessage((message) => {
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
        this._runtimeSession.debug(request, id);

        const response = await responsePromise;
        return response;
    }

    public dispose() {
        this._disposables.forEach((disposable) => disposable.dispose());
    }
}

export async function activatePositron(serviceContainer: IServiceContainer): Promise<void> {
    try {
        const disposables = serviceContainer.get<IDisposableRegistry>(IDisposableRegistry);
        // Register a command to check if ipykernel is bundled for a given interpreter.
        disposables.push(
            vscode.commands.registerCommand('python.isIpykernelBundled', async (pythonPath: string) => {
                const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
                const interpreter = await interpreterService.getInterpreterDetails(pythonPath);
                if (interpreter) {
                    const bundle = await getIpykernelBundle(interpreter, serviceContainer);
                    return bundle.disabledReason === undefined;
                }
                traceError(
                    `Could not check if ipykernel is installed due to an invalid interpreter path: ${pythonPath}`,
                );
                return false;
            }),
        );
        // Register a command to install ipykernel for a given interpreter.
        disposables.push(
            vscode.commands.registerCommand('python.installIpykernel', async (pythonPath: string) => {
                const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
                const interpreter = await interpreterService.getInterpreterDetails(pythonPath);
                if (interpreter) {
                    const installer = serviceContainer.get<IInstaller>(IInstaller);
                    // Check if ipykernel is bundled for the interpreter before trying to install.
                    const bundle = await getIpykernelBundle(interpreter, serviceContainer);
                    if (bundle.disabledReason !== undefined) {
                        // Using a process to install modules avoids using the terminal service,
                        // which has issues waiting for the outcome of the install.
                        const installOptions: InstallOptions = { installAsProcess: true };
                        const installResult = await installer.install(
                            Product.ipykernel,
                            interpreter,
                            undefined,
                            undefined,
                            installOptions,
                        );
                        if (installResult !== InstallerResponse.Installed) {
                            traceError(
                                `Could not install ipykernel for interpreter: ${pythonPath}. Install result - ${installResult}`,
                            );
                        }
                    } else {
                        traceInfo(`Already bundling ipykernel for interpreter ${pythonPath}. No need to install it.`);
                    }
                } else {
                    traceError(`Could not install ipykernel due to an invalid interpreter path: ${pythonPath}`);
                }
            }),
        );
        // Register a command to get the minimum version of python supported by the extension.
        disposables.push(
            vscode.commands.registerCommand('python.getMinimumPythonVersion', (): string => MINIMUM_PYTHON_VERSION.raw),
        );
        // Register a command to output information about Python environments.
        disposables.push(
            vscode.commands.registerCommand(Commands.Show_Interpreter_Debug_Info, async () => {
                // Open up the Python Language Pack output channel.
                await vscode.commands.executeCommand(Commands.ViewOutput);

                // Log information about the Python environments.
                const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
                const interpreters = interpreterService.getInterpreters();
                printInterpreterDebugInfo(interpreters);
            }),
        );

        // Activate detection for web applications
        activateWebAppDetection(disposables);

        // Activate web application commands.
        activateWebAppCommands(serviceContainer, disposables);

        // TODO: How do we handle reusing a debug adapter/session across cells?
        disposables.push(
            vscode.debug.registerDebugAdapterDescriptorFactory('pythonNotebook', {
                async createDebugAdapterDescriptor(
                    debugSession: vscode.DebugSession,
                    _executable: vscode.DebugAdapterExecutable,
                ) {
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

                    const runtimeSession = await positron.runtime.getNotebookSession(notebook.uri);
                    if (!runtimeSession) {
                        return undefined;
                    }

                    const adapter = new PythonNotebookDebugAdapter(debugSession, runtimeSession, notebook);

                    // Execute the cell when the debug session is ready.
                    const disposable = adapter.onDidSendMessage((message) => {
                        console.log(message);
                        if (
                            'type' in message &&
                            message.type === 'response' &&
                            'command' in message &&
                            message.command === 'configurationDone'
                        ) {
                            disposable.dispose();

                            // Execute the cell.
                            vscode.commands.executeCommand('notebook.cell.execute', {
                                ranges: [{ start: cell.index, end: cell.index + 1 }],
                                document: cell.notebook.uri,
                            });
                        }
                    });

                    // End the debug session when the cell execution is complete.
                    (async () => {
                        const codeExecutionEvent = await new Promise<positron.CodeExecutionEvent>((resolve) => {
                            const disposable = positron.runtime.onDidExecuteCode((event) => {
                                // TODO: restrict to cell and session ID as well?
                                if (
                                    event.attribution.source === positron.CodeAttributionSource.Notebook &&
                                    // TODO: what does this look like for untitled/unsaved files?
                                    event.attribution.metadata?.notebook === notebook.uri.fsPath
                                ) {
                                    disposable.dispose();
                                    resolve(event);
                                }
                            });
                        });

                        // Now wait for the execution to complete...
                        await new Promise<void>((resolve) => {
                            const disposable = runtimeSession.onDidReceiveRuntimeMessage((message) => {
                                if (
                                    message.parent_id === codeExecutionEvent.executionId &&
                                    message.type === positron.LanguageRuntimeMessageType.State &&
                                    (message as positron.LanguageRuntimeState).state ===
                                        positron.RuntimeOnlineState.Idle
                                ) {
                                    disposable.dispose();
                                    resolve();
                                }
                            });
                        });

                        // End the debug session.
                        await vscode.debug.stopDebugging(debugSession);
                    })();

                    // End the debug session when an interrupt is received.
                    // TODO: need to also dispose things from above in each end case...
                    //       does the adapter get disposed?
                    const stateDisposable = runtimeSession.onDidChangeRuntimeState(async (state) => {
                        console.log(`Runtime state changed: ${state}`);
                        if (state === positron.RuntimeState.Interrupting) {
                            stateDisposable.dispose();
                            await vscode.debug.stopDebugging(debugSession);
                        }
                    });

                    // const adapter = new PythonNotebookDebugAdapter(debugSession, runtimeSession, notebook, cell);
                    return new vscode.DebugAdapterInlineImplementation(adapter);
                },
            }),
        );

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
                    type: 'pythonNotebook',
                    name: path.basename(notebookEditor.notebook.uri.fsPath),
                    request: 'attach',
                    // TODO: Get from config.
                    justMyCode: false,
                    __notebookUri: notebookEditor.notebook.uri.toString(),
                    __cellUri: cellUri.toString(),
                });
            }),
        );

        // Activate walkthrough commands.
        activateWalkthroughCommands(disposables);

        // Register the language server manager to support multiple console sessions.
        registerLanguageServerManager(serviceContainer, disposables);

        traceInfo('activatePositron: done!');
    } catch (ex) {
        traceError('activatePositron() failed.', ex);
    }
}
