// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import '../../common/extensions';
import { Disposable, LanguageClient, LanguageClientOptions } from 'vscode-languageclient/node';

// --- Start Positron ---
import * as positron from 'positron';
import * as vscode from 'vscode';
import * as path from 'path';
import { EXTENSION_ROOT_DIR } from '../../common/constants';
import { ChildProcess } from 'child_process';
// --- End Positron ---
import { Resource } from '../../common/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { captureTelemetry } from '../../telemetry';
import { EventName } from '../../telemetry/constants';
import { JediLanguageClientMiddleware } from './languageClientMiddleware';
import { ProgressReporting } from '../progress';
// --- Start Positron ---
import { ILanguageServerProxy } from '../types';
import { killPid } from '../../common/process/rawProcessApis';
import { JediLanguageClientFactory } from './languageClientFactory';
import { IInterpreterService } from '../../interpreter/contracts';
import { traceDecoratorError, traceDecoratorVerbose, traceError, traceVerbose, traceWarn } from '../../logging';
import { IServiceContainer } from '../../ioc/types';
import { IPythonExecutionFactory } from '../../common/process/types';
// --- End Positron ---

export class JediLanguageServerProxy implements ILanguageServerProxy {
    private languageClient: LanguageClient | undefined;
    // --- Start Positron ---
    private extensionVersion: string | undefined;
    // --- End Positron ---
    private readonly disposables: Disposable[] = [];

    private lsVersion: string | undefined;

    // --- Start Positron ---
    constructor(
        private readonly serviceContainer: IServiceContainer,
        private readonly interpreterService: IInterpreterService,
        private readonly factory: JediLanguageClientFactory
    ) {
        // Get the version of this extension from package.json so that we can
        // describe the implementation version to the kernel adapter
        try {
            const packageJson = require('../../../../package.json');
            this.extensionVersion = packageJson.version;
        } catch (e) {
            traceVerbose("Unable to read package.json to determine our extension version", e);
        }
    }
    // --- End Positron ---

    private static versionTelemetryProps(instance: JediLanguageServerProxy) {
        return {
            lsVersion: instance.lsVersion,
        };
    }

    @traceDecoratorVerbose('Disposing language server')
    public dispose(): void {
        this.stop().ignoreErrors();
    }

    @traceDecoratorError('Failed to start language server')
    @captureTelemetry(
        EventName.JEDI_LANGUAGE_SERVER_ENABLED,
        undefined,
        true,
        undefined,
        JediLanguageServerProxy.versionTelemetryProps,
    )
    public async start(
        resource: Resource,
        interpreter: PythonEnvironment | undefined,
        options: LanguageClientOptions,
    ): Promise<void> {
        this.lsVersion =
            (options.middleware ? (<JediLanguageClientMiddleware>options.middleware).serverVersion : undefined) ??
            '0.19.3';

        try {
            // --- Start Positron ---

            // Favor the active interpreter, if one is available
            const activeInterpreter = await this.interpreterService.getActiveInterpreter(resource);
            const targetInterpreter = activeInterpreter ? activeInterpreter : interpreter;

            // Determine if our Jupyter Adapter extension is installed
            const ext = vscode.extensions.getExtension('vscode.jupyter-adapter');
            const hasKernel = await this.hasIpyKernelModule(targetInterpreter, this.serviceContainer);
            if (ext && hasKernel) {

                // If our adapter is installed, and if the active Python interpreter has the IPyKernel module
                // installed, we'll use it to manage our language runtime. It will start a combined LSP and
                // IPyKernel server, providing enhanced code insights to the Editor and supports our
                // Python REPL console. The language client will connect to the server via TCP.
                this.withActiveExtention(ext, async () => {
                    const disposable: vscode.Disposable = await this.registerLanguageRuntime(ext, targetInterpreter, options, hasKernel);
                    this.disposables.push(disposable);
                });

            } else {

                // Otherwise, use the default Jedi LSP for the Editor
                traceWarn('Could not find Jupyter Adapter extension to register an enhanced Python runtime. Creating an LSP only.');
                const client = await this.factory.createLanguageClient(resource, targetInterpreter, options);
                this.startClient(client);
            }
            // --- End Positron ---
        } catch (ex) {
            traceError('Failed to start language server:', ex);
            throw new Error('Launching Jedi language server using python failed, see output.');
        }
    }

    // --- Start Positron ---

    /**
     * Checks if a given python environment has the ipykernel module installed.
     */
    private async hasIpyKernelModule(interpreter: PythonEnvironment | undefined, serviceContainer: IServiceContainer): Promise<boolean> {
        if (!interpreter) { return false; }
        const pythonFactory = serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);
        let pythonService = await pythonFactory.create({ pythonPath: interpreter.path });
        return pythonService.isModuleInstalled('ipykernel');
    }

    /**
     * Register our Jedi LSP as a language runtime with our Jupyter Adapter extension.
     * The LSP will find an available port to start via TCP, and the Jupyter Adapter will configure
     * IPyKernel with a connection file.
     */
    private async registerLanguageRuntime(ext: vscode.Extension<any>, interpreter: PythonEnvironment | undefined, options: LanguageClientOptions, hasKernel: boolean): Promise<Disposable> {

        // Find an available port for our TCP server
        const portfinder = require('portfinder');
        const port = await portfinder.getPortPromise();

        // Customize Jedi LSP entrypoint that adds a resident IPyKernel
        const command = interpreter ? interpreter.path : 'python';
        const pythonVersion = interpreter?.version?.raw;
        const lsScriptPath = path.join(EXTENSION_ROOT_DIR, 'pythonFiles', 'ipykernel_jedi.py');
        const args = [command, lsScriptPath, `--port=${port}`, '-f', '{connection_file}', '--logfile', '{log_file}']
        const kernelSpec = {
            argv: args,
            display_name: `${interpreter?.displayName} (ipykernel)`,
            language: 'Python',
            metadata: { debugger: false }
        };
        traceVerbose(`Configuring Jedi LSP with IPyKernel using args '${args}'`);

        // Create an adapter for the kernel as our language runtime
        const startupBehavior = hasKernel ? positron.LanguageRuntimeStartupBehavior.Implicit : positron.LanguageRuntimeStartupBehavior.Explicit;
        const runtime = ext.exports.adaptKernel(kernelSpec, 'Python', pythonVersion, this.extensionVersion, startupBehavior, () => {
            // The adapter will create a language client to connect to the LSP via TCP
            return this.activateClientTCP(port, options);
        });

        // Register our language runtime provider
        return positron.runtime.registerLanguageRuntime(runtime);
    }

    /**
     * Creates and starts a language client to connect to our LSP via TCP
     */
    private async activateClientTCP(port: number, options: LanguageClientOptions): Promise<void> {
        const client = await this.factory.createLanguageClientTCP(port, options);
        this.startClient(client);
    }

    /**
     * Starts the language client and registers it for disposal
     */
    private async startClient(client: LanguageClient): Promise<void> {
        this.registerHandlers(client);
        await client.start();
        this.languageClient = client;
    }

    /**
     * Utility to ensure an extension is active before an action is performed
     */
    private withActiveExtention(ext: vscode.Extension<any>, callback: () => void) {
        if (ext.isActive) {
            callback();
        } else {
            ext.activate().then(callback);
        }
    }
    // --- End Positron ---

    @traceDecoratorVerbose('Stopping language server')
    public async stop(): Promise<void> {
        while (this.disposables.length > 0) {
            const d = this.disposables.shift()!;
            d.dispose();
        }

        if (this.languageClient) {
            const client = this.languageClient;
            this.languageClient = undefined;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pid: number | undefined = ((client as any)._serverProcess as ChildProcess)?.pid;
            const killServer = () => {
                if (pid) {
                    killPid(pid);
                }
            };

            try {
                await client.stop();
                await client.dispose();
                killServer();
            } catch (ex) {
                traceError('Stopping language client failed', ex);
                killServer();
            }
        }
    }

    // eslint-disable-next-line class-methods-use-this
    public loadExtension(): void {
        // No body.
    }

    @captureTelemetry(
        EventName.JEDI_LANGUAGE_SERVER_READY,
        undefined,
        true,
        undefined,
        JediLanguageServerProxy.versionTelemetryProps,
    )
    private registerHandlers(client: LanguageClient) {
        const progressReporting = new ProgressReporting(client);
        this.disposables.push(progressReporting);
    }
}
