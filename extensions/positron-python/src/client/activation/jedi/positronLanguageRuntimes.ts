/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Socket } from 'net';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { Disposable, LanguageClient, LanguageClientOptions, ServerOptions, StreamInfo } from 'vscode-languageclient/node';

import { compare } from 'semver';
import { EXTENSION_ROOT_DIR, PYTHON_LANGUAGE } from '../../common/constants';
import { IPythonExecutionFactory } from '../../common/process/types';
import { Resource } from '../../common/types';
import { IInterpreterService } from '../../interpreter/contracts';
import { IServiceContainer } from '../../ioc/types';
import { traceError, traceVerbose } from '../../logging';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { PythonVersion } from '../../pythonEnvironments/info/pythonVersion';
import { ProgressReporting } from '../progress';
import { ILanguageServerProxy } from '../types';

/**
 * Positron's variant of JediLanguageServerProxy. On start up it registers Python runtimes
 * with our Jupyter Adapter, combining both a Jedi based LSP and IPyKernel for enhanced
 * code completions. Language Client start is controlled by our Jupyter Adapter.
 *
 * Note that LSP connections are made over TCP.
 */
export class PositronJediLanguageServerProxy implements ILanguageServerProxy {

    private readonly disposables: Disposable[] = [];
    private readonly languageClients: LanguageClient[] = [];
    private extensionVersion: string | undefined;

    constructor(
        private readonly serviceContainer: IServiceContainer,
        private readonly interpreterService: IInterpreterService,
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

    // ILanguageServerProxy API

    public async start(
        resource: Resource,
        interpreter: PythonEnvironment | undefined,
        options: LanguageClientOptions,
    ): Promise<void> {

        // Determine if our Jupyter Adapter extension is installed
        const ext = vscode.extensions.getExtension('vscode.jupyter-adapter');
        if (!ext) {
            const msg = `Could not find Jupyter Adapter extension; can't register Python kernels.`;
            vscode.window.showErrorMessage(msg);
            return;
        }

        // Register available python interpreters as language runtimes with our Jupyter Adapter
        this.withActiveExtention(ext, async () => {
            await this.registerLanguageRuntimes(ext, resource, interpreter, options);
        });
    }

    public loadExtension(): void {
        // Not used.
    }

    public async stop(): Promise<void> {

        // Dispose of any runtimes and related resources
        while (this.disposables.length > 0) {
            const r = this.disposables.shift()!;
            r.dispose();
        }

        // Dispose of any language clients
        for (let client of this.languageClients) {
            try {
                await client.stop();
                await client.dispose();
            } catch (ex) {
                traceError('Stopping language client failed', ex);
            }
        }
    }

    public dispose(): void {
        this.stop().ignoreErrors();
    }

    /**
     * Register available python environments as a language runtime with the Jupyter Adapter.
     */
    private async registerLanguageRuntimes(
        ext: vscode.Extension<any>,
        defaultResource: Resource,
        defaultInterpreter: PythonEnvironment | undefined,
        options: LanguageClientOptions
    ): Promise<void> {

        let interpreters: PythonEnvironment[] = this.interpreterService.getInterpreters();

        // Sort the available interpreters, favoring the active interpreter (if one is available)
        const activeInterpreter = await this.interpreterService.getActiveInterpreter(defaultResource);
        const preferredInterpreter = activeInterpreter ? activeInterpreter : defaultInterpreter;
        interpreters = this.sortInterpreters(interpreters, preferredInterpreter);


        // Register each interpreter as a language runtime
        const portfinder = require('portfinder');
        let lspPort = 2087;
        for (let interpreter of interpreters) {
            // Find an available port for our TCP server, starting the search from
            // the next port each iteration.
            lspPort++;
            lspPort = await portfinder.getPortPromise({ port: lspPort });

            const runtime: vscode.Disposable = await this.registerLanguageRuntime(ext, interpreter, lspPort, options);
            this.disposables.push(runtime);
        }
    }

    /**
     * Register our Jedi LSP as a language runtime with our Jupyter Adapter extension.
     * The LSP will find an available port to start via TCP, and the Jupyter Adapter will configure
     * IPyKernel with a connection file.
     */
    private async registerLanguageRuntime(ext: vscode.Extension<any>,
        interpreter: PythonEnvironment,
        lspPort: number,
        options: LanguageClientOptions): Promise<Disposable> {

        // Determine if the ipykernel module is installed
        const hasKernel = await this.hasIpyKernelModule(interpreter, this.serviceContainer);
        const startupBehavior = hasKernel ? positron.LanguageRuntimeStartupBehavior.Implicit : positron.LanguageRuntimeStartupBehavior.Explicit;

        // Customize Jedi LSP entrypoint that adds a resident IPyKernel
        const displayName = interpreter.displayName + (hasKernel ? ' (ipykernel)' : '');
        const command = interpreter.path;
        const pythonVersion = interpreter.version?.raw;
        const lsScriptPath = path.join(EXTENSION_ROOT_DIR, 'pythonFiles', 'ipykernel_jedi.py');
        const args = [command, lsScriptPath, `--port=${lspPort}`, '-f', '{connection_file}', '--logfile', '{log_file}']
        const kernelSpec = {
            argv: args,
            display_name: `${displayName}`,
            language: PYTHON_LANGUAGE,
            metadata: { debugger: false }
        };
        traceVerbose(`Configuring Jedi LSP with IPyKernel using args '${args}'`);

        // Create a language client to connect to the LSP via TCP
        const client = await this.createLanguageClientTCP(lspPort, options);

        // Create an adapter for the kernel as our language runtime
        const runtime: positron.LanguageRuntime = ext.exports.adaptKernel(kernelSpec, PYTHON_LANGUAGE, pythonVersion, this.extensionVersion, startupBehavior, () => {
            this.startClient(client);
        });

        // Also stop the language client when the runtime is exiting
        runtime.onDidChangeRuntimeState(state => {
            if (client.isRunning() && (
                state === positron.RuntimeState.Exiting ||
                state === positron.RuntimeState.Exited)) {
                client.stop();
            }
        });

        // Register our language runtime provider
        return positron.runtime.registerLanguageRuntime(runtime);
    }

    // Returns a sorted copy of the array of Python environments, in descending order
    private sortInterpreters(interpreters: PythonEnvironment[], preferredInterpreter: PythonEnvironment | undefined): PythonEnvironment[] {
        const copy: PythonEnvironment[] = [...interpreters];
        copy.sort((a: PythonEnvironment, b: PythonEnvironment) => {

            // Favor preferred interpreter, if specified, in descending order
            if (preferredInterpreter) {
                if (preferredInterpreter.id === a.id) return -1;
                if (preferredInterpreter.id === b.id) return 1;
            }

            // Compare versions in descending order
            const av: string = this.getVersionString(a.version);
            const bv: string = this.getVersionString(b.version);
            return -compare(av, bv);
        });
        return copy;
    }

    /**
     * Formats python version info as a semver string, adapted from
     * common/utils/version to work with PythonVersion instances.
     */
    private getVersionString(info: PythonVersion | undefined): string {
        if (!info) { return '0' };
        if (info.major < 0) {
            return '';
        }
        if (info.minor < 0) {
            return `${info.major}`;
        }
        if (info.patch < 0) {
            return `${info.major}.${info.minor}`;
        }
        return `${info.major}.${info.minor}.${info.patch}`;
    }

    /**
     * Checks if a given python environment has the ipykernel module installed.
     */
    private async hasIpyKernelModule(interpreter: PythonEnvironment | undefined, serviceContainer: IServiceContainer): Promise<boolean> {
        if (!interpreter) {
            return false;
        }
        const pythonFactory = serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);
        let pythonService = await pythonFactory.create({ pythonPath: interpreter.path });
        return pythonService.isModuleInstalled('ipykernel');
    }

    /**
     * Start the language client
     */
    private async startClient(client: LanguageClient): Promise<void> {
        this.registerHandlers(client);
        await client.start();
        this.languageClients.push(client);
    }

    /**
    * Finds an available port to spawn a new Jedi LSP in TCP mode and returns a LanguageClient
    * configured to connect to this server.
    */
    private async createLanguageClientTCP(
        port: number,
        clientOptions: LanguageClientOptions,
    ): Promise<LanguageClient> {

        // Configure language client to connect to LSP via TCP on start
        const serverOptions: ServerOptions = async () => { return this.getServerOptions(port); };
        return new LanguageClient(PYTHON_LANGUAGE, 'Positron Python Jedi', serverOptions, clientOptions);
    }

    /**
     * An async function used by the LanguageClient to establish a connection to the LSP on start.
     * Several attempts to connect are made given recently spawned servers may not be ready immediately
     * for client connections.
     * @param port the LSP port
     */
    private async getServerOptions(port: number): Promise<StreamInfo> {

        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        const max_attempts = 20;
        const base_delay = 50;
        const multiplier = 1.5;

        for (let attempt = 0; attempt < max_attempts; attempt++) {
            // Retry up to five times then start to back-off
            const interval = attempt < 6 ? base_delay : base_delay * multiplier * attempt;
            if (attempt > 0) {
                await delay(interval);
            }

            try {
                // Try to connect to LSP port
                const socket: Socket = await this.tryToConnect(port);
                return { reader: socket, writer: socket };
            } catch (error: any) {
                if (error?.code == 'ECONNREFUSED') {
                    traceVerbose(`Error '${error.message}' on connection attempt '${attempt}' to Jedi LSP on port '${port}', will retry`);
                } else {
                    throw error;
                }
            }
        }

        throw new Error(`Failed to create TCP connection to Jedi LSP on port ${port} after multiple attempts`);
    }

    /**
     * Attempts to establish a TCP socket connection to the given port
     * @param port the server port to connect to
     */
    private async tryToConnect(port: number): Promise<Socket> {
        return new Promise((resolve, reject) => {
            const socket = new Socket();
            socket.on('ready', () => {
                resolve(socket);
            });
            socket.on('error', (error) => {
                reject(error);
            });
            socket.connect(port);
        });
    }

    private registerHandlers(client: LanguageClient) {
        const progressReporting = new ProgressReporting(client);
        this.disposables.push(progressReporting);
    }

    private withActiveExtention(ext: vscode.Extension<any>, callback: () => void) {
        if (ext.isActive) {
            callback();
        } else {
            ext.activate().then(callback);
        }
    }
}
