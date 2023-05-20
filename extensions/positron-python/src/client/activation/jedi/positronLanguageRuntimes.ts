/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable class-methods-use-this */
/* eslint-disable global-require */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Socket } from 'net';
import * as path from 'path';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import { Disposable, DocumentFilter, LanguageClient, LanguageClientOptions, ServerOptions, StreamInfo } from 'vscode-languageclient/node';

import { compare } from 'semver';
import { EXTENSION_ROOT_DIR, PYTHON_LANGUAGE } from '../../common/constants';
import { IConfigurationService, IInstaller, InstallerResponse, Product, Resource } from '../../common/types';
import { InstallOptions } from '../../common/installer/types';
import { IInterpreterService } from '../../interpreter/contracts';
import { IServiceContainer } from '../../ioc/types';
import { traceError, traceVerbose } from '../../logging';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { PythonVersion } from '../../pythonEnvironments/info/pythonVersion';
import { ProgressReporting } from '../progress';
import { ILanguageServerProxy } from '../types';

// TODO@softwarenerd - I would like to load this from a file, but I am not smart enough to do it.
const iconSVG = `
<svg version="1.1" id="Layer_2" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 100 100" enable-background="new 0 0 100 100" xml:space="preserve">
<linearGradient id="path1948_00000071526733124438898100000001732512360045835445_" gradientUnits="userSpaceOnUse" x1="732.4655" y1="-296.523" x2="826.8008" y2="-377.6859" gradientTransform="matrix(0.5625 0 0 -0.568 -412.6414 -165.0309)">
	<stop  offset="0" style="stop-color:#5C9FD3"/>
	<stop  offset="1" style="stop-color:#316A99"/>
</linearGradient>
<path id="path1948" fill="url(#path1948_00000071526733124438898100000001732512360045835445_)" d="M49.3,0.6c-4,0-7.8,0.4-11.1,0.9c-9.8,1.7-11.6,5.4-11.6,12.1v8.8h23.2v2.9H26.6h-8.7c-6.7,0-12.6,4.1-14.5,11.8c-2.1,8.8-2.2,14.4,0,23.6C5,67.6,9,72.5,15.7,72.5h8V61.9c0-7.7,6.6-14.4,14.5-14.4h23.2c6.5,0,11.6-5.3,11.6-11.8V13.6c0-6.3-5.3-11-11.6-12.1C57.4,0.9,53.2,0.6,49.3,0.6zM36.7,7.7c2.4,0,4.4,2,4.4,4.4c0,2.4-2,4.4-4.4,4.4c-2.4,0-4.4-2-4.4-4.4C32.4,9.7,34.3,7.7,36.7,7.7z"/>
<linearGradient id="path1950_00000115508837870230036860000012441612979432214151_" gradientUnits="userSpaceOnUse" x1="863.2715" y1="-426.8091" x2="829.5844" y2="-379.1477" gradientTransform="matrix(0.5625 0 0 -0.568 -412.6414 -165.0309)">
	<stop  offset="0" style="stop-color:#FFD53D"/>
	<stop  offset="1" style="stop-color:#FEE875"/>
</linearGradient>
<path id="path1950" fill="url(#path1950_00000115508837870230036860000012441612979432214151_)" d="M75.9,25.4v10.3c0,8-6.8,14.7-14.5,14.7H38.2c-6.3,0-11.6,5.4-11.6,11.8v22.1c0,6.3,5.5,10,11.6,11.8c7.3,2.2,14.4,2.5,23.2,0C67.2,94.4,73,91,73,84.3v-8.8H49.8v-2.9H73h11.6c6.7,0,9.3-4.7,11.6-11.8c2.4-7.3,2.3-14.3,0-23.6c-1.7-6.7-4.8-11.8-11.6-11.8L75.9,25.4z M62.8,81.4c2.4,0,4.4,2,4.4,4.4c0,2.4-1.9,4.4-4.4,4.4c-2.4,0-4.4-2-4.4-4.4C58.5,83.3,60.4,81.4,62.8,81.4z"/>
</svg>`;
const base64EncodedIconSvg = Buffer.from(iconSVG).toString('base64');

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

    private readonly installer: IInstaller;

    // Using a process to install modules avoids using the terminal service,
    // which has issues waiting for the outcome of the install.
    private readonly installOptions: InstallOptions = { installAsProcess: true };

    constructor(
        private readonly serviceContainer: IServiceContainer,
        private readonly interpreterService: IInterpreterService,
        private configService: IConfigurationService
    ) {
        // Get the version of this extension from package.json so that we can
        // describe the implementation version to the kernel adapter
        try {
            const packageJson = require('../../../../package.json');
            this.extensionVersion = packageJson.version;
        } catch (e) {
            traceVerbose("Unable to read package.json to determine our extension version", e);
        }

        this.installer = this.serviceContainer.get<IInstaller>(IInstaller);
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

        // Extend LSP support to include unsaved editors
        options.documentSelector = this.initDocumentSelector(options.documentSelector as DocumentFilter[]);

        // Offer to install the ipykernel module for the preferred interpreter, if it is missing
        const hasKernel = await this.installer.isInstalled(Product.ipykernel, interpreter);
        if (!hasKernel) {
            const response = await this.installer.promptToInstall(Product.ipykernel,
                interpreter, undefined, undefined, this.installOptions);
            if (response === InstallerResponse.Installed) {
                traceVerbose(`Successfully installed ipykernel for ${interpreter?.displayName}`);
            }
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
        for (const client of this.languageClients) {
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
     * Generalize LSP support to any scheme that is for the language 'python'.
     */
    private initDocumentSelector(selector: DocumentFilter[]): DocumentFilter[] {
        return selector.concat([{ language: PYTHON_LANGUAGE }]);
    }

    /**
     * Register available python environments as a language runtime with the Jupyter Adapter.
     */
    private async registerLanguageRuntimes(
        ext: vscode.Extension<any>,
        resource: Resource,
        preferredInterpreter: PythonEnvironment | undefined,
        options: LanguageClientOptions
    ): Promise<void> {

        // Sort the available interpreters, favoring the active interpreter (if one is available)
        let interpreters: PythonEnvironment[] = this.interpreterService.getInterpreters();
        interpreters = this.sortInterpreters(interpreters, preferredInterpreter);

        // Check if debug should be enabled for the language server
        const settings = this.configService.getSettings(resource);
        const debug = settings.languageServerDebug;

        // Register each interpreter as a language runtime
        const portfinder = require('portfinder');
        let debugPort;
        for (const interpreter of interpreters) {

            // If required, also locate an available port for the debugger
            if (debug) {
                if (debugPort === undefined) {
                    debugPort = 5678; // Default port for debugpy
                }
                debugPort = await portfinder.getPortPromise({ port: debugPort });
            }

            const runtime: vscode.Disposable = await this.registerLanguageRuntime(ext, interpreter, debugPort, options);
            this.disposables.push(runtime);

            if (debugPort !== undefined) {
                debugPort += 1;
            }
        }
    }

    /**
     * Register our Jedi LSP as a language runtime with our Jupyter Adapter extension.
     * The LSP will find an available port to start via TCP, and the Jupyter Adapter will configure
     * IPyKernel with a connection file.
     */
    private async registerLanguageRuntime(
        ext: vscode.Extension<any>,
        interpreter: PythonEnvironment,
        debugPort: number | undefined,
        options: LanguageClientOptions): Promise<Disposable> {

        // Determine if the ipykernel module is installed
        const hasKernel = await this.installer.isInstalled(Product.ipykernel, interpreter);
        const startupBehavior = hasKernel ? positron.LanguageRuntimeStartupBehavior.Implicit : positron.LanguageRuntimeStartupBehavior.Explicit;

        // Customize Jedi LSP entrypoint that adds a resident IPyKernel
        const displayName = interpreter.displayName + (hasKernel ? ' (ipykernel)' : '');
        const command = interpreter.path;
        const pythonVersion = interpreter.version?.raw;
        const lsScriptPath = path.join(EXTENSION_ROOT_DIR, 'pythonFiles', 'positron_language_server.py');
        const args = [command, lsScriptPath, '-f', '{connection_file}', '--logfile', '{log_file}']
        if (debugPort) {
            args.push(`--debugport=${debugPort}`);
        }
        const kernelSpec = {
            path: interpreter.path,
            argv: args,
            display_name: `${displayName}`,
            language: 'Python', // Used as metadata.languageName
            metadata: { debugger: false }
        };
        traceVerbose(`Configuring Jedi LSP with IPyKernel using args '${args}'`);

        // Create an adapter for the kernel as our language runtime
        const runtime: positron.LanguageRuntime = ext.exports.adaptKernel(kernelSpec,
            PYTHON_LANGUAGE,
            pythonVersion,
            this.extensionVersion,
            base64EncodedIconSvg,
            '>>>',
            '...',
            startupBehavior,
            (port: number) => this.startClient(options, port));

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
     * Start the language client
     */
    private async startClient(clientOptions: LanguageClientOptions, port: number): Promise<void> {

        // Configure language client to connect to LSP via TCP on start
        const serverOptions: ServerOptions = async () => this.getServerOptions(port);
        const client = new LanguageClient(PYTHON_LANGUAGE, 'Positron Python Jedi', serverOptions, clientOptions);
        this.registerHandlers(client);
        await client.start();
        this.languageClients.push(client);
    }

    /**
     * An async function used by the LanguageClient to establish a connection to the LSP on start.
     * Several attempts to connect are made given recently spawned servers may not be ready immediately
     * for client connections.
     * @param port the LSP port
     */
    private async getServerOptions(port: number): Promise<StreamInfo> {

        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        const maxAttempts = 20;
        const baseDelay = 50;
        const multiplier = 1.5;

        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            // Retry up to five times then start to back-off
            const interval = attempt < 6 ? baseDelay : baseDelay * multiplier * attempt;
            if (attempt > 0) {
                await delay(interval);
            }

            try {
                // Try to connect to LSP port
                const socket: Socket = await this.tryToConnect(port);
                return { reader: socket, writer: socket };
            } catch (error: any) {
                if (error?.code === 'ECONNREFUSED') {
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
