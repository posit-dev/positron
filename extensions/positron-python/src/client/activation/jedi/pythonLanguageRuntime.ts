/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import { JupyterAdapterApi, JupyterKernelSpec, JupyterLanguageRuntime } from '../../jupyter-adapter.d';

/**
 * A Positron Python language runtime that wraps a Jupyter kernel runtime.
 * Fulfills most Language Runtime API calls by delegating to the wrapped kernel.
 */
export class PythonLanguageRuntime implements JupyterLanguageRuntime {

    /** The Jupyter kernel-based implementation of the Language Runtime API */
    private _kernel: JupyterLanguageRuntime;

    /**
     * Create a new PythonLanguageRuntime object to wrap a Jupyter kernel.
     *
     * @param kernelSpec The specification of the Jupyter kernel to wrap.
     * @param metadata The metadata of the language runtime to create.
     * @param adapterApi The API of the Jupyter Adapter extension.
     */
    constructor(
        readonly kernelSpec: JupyterKernelSpec,
        readonly metadata: positron.LanguageRuntimeMetadata,
        readonly adapterApi: JupyterAdapterApi) {

        this._kernel = adapterApi.adaptKernel(kernelSpec, metadata);

        this.onDidChangeRuntimeState = this._kernel.onDidChangeRuntimeState;
        this.onDidReceiveRuntimeMessage = this._kernel.onDidReceiveRuntimeMessage;
    }

    startPositronLsp(clientAddress: string): void {
        this._kernel.startPositronLsp(clientAddress);
    }

    emitJupyterLog(message: string): void {
        this._kernel.emitJupyterLog(message);
    }

    onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage>;

    onDidChangeRuntimeState: vscode.Event<positron.RuntimeState>;

    execute(code: string, id: string, mode: positron.RuntimeCodeExecutionMode, errorBehavior: positron.RuntimeErrorBehavior): void {
        this._kernel.execute(code, id, mode, errorBehavior);
    }

    isCodeFragmentComplete(code: string): Thenable<positron.RuntimeCodeFragmentStatus> {
        return this._kernel.isCodeFragmentComplete(code);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-explicit-any
    createClient(id: string, type: positron.RuntimeClientType, params: any): Thenable<void> {
        return this._kernel.createClient(id, type, params);
    }

    listClients(type?: positron.RuntimeClientType | undefined): Thenable<Record<string, string>> {
        return this._kernel.listClients(type);
    }

    removeClient(id: string): void {
        this._kernel.removeClient(id);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-explicit-any
    sendClientMessage(clientId: string, messageId: string, message: any): void {
        this._kernel.sendClientMessage(clientId, messageId, message);
    }

    replyToPrompt(id: string, reply: string): void {
        this._kernel.replyToPrompt(id, reply);
    }

    start(): Thenable<positron.LanguageRuntimeInfo> {
        return this._kernel.start();
    }

    async interrupt(): Promise<void> {
        return this._kernel.interrupt();
    }

    async restart(): Promise<void> {
        return this._kernel.restart();
    }

    async shutdown(): Promise<void> {
        return this._kernel.shutdown();
    }
}
