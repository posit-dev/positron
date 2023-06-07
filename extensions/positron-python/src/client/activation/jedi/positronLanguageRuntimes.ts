/* eslint-disable class-methods-use-this */
/* eslint-disable global-require */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { Disposable, DocumentFilter, LanguageClientOptions } from 'vscode-languageclient/node';

import * as semver from 'semver';
import { EXTENSION_ROOT_DIR, PYTHON_LANGUAGE } from '../../common/constants';
import { IConfigurationService, IDisposableRegistry, IInstaller, InstallerResponse, Product, Resource } from '../../common/types';
import { InstallOptions } from '../../common/installer/types';
import { IInterpreterService } from '../../interpreter/contracts';
import { IServiceContainer } from '../../ioc/types';
import { traceVerbose } from '../../logging';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { PythonVersion } from '../../pythonEnvironments/info/pythonVersion';
import { ILanguageServerProxy } from '../types';
import { PythonLanguageRuntime } from './pythonLanguageRuntime';
import { JupyterAdapterApi } from '../../jupyter-adapter.d'

// Load the Python icon.
const base64EncodedIconSvg = fs.readFileSync(path.join(EXTENSION_ROOT_DIR, 'resources', 'branding', 'python-icon.svg')).toString('base64');

/**
 * Positron's variant of JediLanguageServerProxy. On start up it registers Python runtimes
 * with our Jupyter Adapter, combining both a Jedi based LSP and IPyKernel for enhanced
 * code completions. Language Client start is controlled by our Jupyter Adapter.
 *
 * Note that LSP connections are made over TCP.
 */
export class PositronJediLanguageServerProxy implements ILanguageServerProxy {

    private readonly disposables: IDisposableRegistry;

    private extensionVersion: string | undefined;

    private readonly installer: IInstaller;

    // Using a process to install modules avoids using the terminal service,
    // which has issues waiting for the outcome of the install.
    private readonly installOptions: InstallOptions = { installAsProcess: true };

    private registered = false;

    private readonly minimumSupportedVersion = '3.8.0';

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

        this.disposables = serviceContainer.get<IDisposableRegistry>(IDisposableRegistry);
        this.installer = this.serviceContainer.get<IInstaller>(IInstaller);
    }

    // ILanguageServerProxy API

    public async start(
        resource: Resource,
        interpreter: PythonEnvironment | undefined,
        options: LanguageClientOptions,
    ): Promise<void> {

        // Positron manages the language server lifecycle instead of the extension. We instead use
        // this method to register the language runtime with Positron. Keeping the registration logic
        // in `ILanguageServerProxy` lets us benefit from the existing setup of `resource` (the
        // workspace folder URI), `interpreter`, and language server `options`, as well as disposing.

        // Only register language runtimes with Positron once.
        if (this.registered) {
            return;
        }
        this.registered = true;

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
            // Create typesafe reference to the Jupyter Adapter's API
            const jupyterAdapterApi = ext.exports as JupyterAdapterApi;

            // Register the language runtimes for each available interpreter
            await this.registerLanguageRuntimes(jupyterAdapterApi, resource, interpreter, options);
        });
    }

    public loadExtension(): void {
        // Not used.
    }

    public async stop(): Promise<void> {
        // Do nothing. Let Positron manage the language server lifecycle.
    }

    public dispose(): void {
        // Do nothing. Let Positron manage the language server lifecycle, and this is called on
        // stopLanguageServer.
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
        jupyterAdapterApi: JupyterAdapterApi,
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
        const logLevel = settings.languageServerLogLevel;

        // Register each interpreter as a language runtime
        const portfinder = require('portfinder');
        let debugPort;
        for (const interpreter of interpreters) {

            // Only register runtimes for supported versions
            if (this.isVersionSupported(interpreter?.version)) {

                // If required, also locate an available port for the debugger
                if (debug) {
                    if (debugPort === undefined) {
                        debugPort = 5678; // Default port for debugpy
                    }
                    debugPort = await portfinder.getPortPromise({ port: debugPort });
                }

                const runtime: vscode.Disposable = await this.registerLanguageRuntime(
                    jupyterAdapterApi, interpreter, debugPort, logLevel, options);
                this.disposables.push(runtime);

                if (debugPort !== undefined) {
                    debugPort += 1;
                }
            } else {
                traceVerbose(`Not registering runtime due to unsupported interpreter version ${interpreter.displayName}`);
            }
        }
    }

    /**
     * Register our Jedi LSP as a language runtime with our Jupyter Adapter extension.
     * The LSP will find an available port to start via TCP, and the Jupyter Adapter will configure
     * IPyKernel with a connection file.
     */
    private async registerLanguageRuntime(
        jupyterAdapterApi: JupyterAdapterApi,
        interpreter: PythonEnvironment,
        debugPort: number | undefined,
        logLevel: string,
        options: LanguageClientOptions): Promise<Disposable> {

        // Determine if the ipykernel module is installed
        const hasKernel = await this.installer.isInstalled(Product.ipykernel, interpreter);
        const startupBehavior = hasKernel ? positron.LanguageRuntimeStartupBehavior.Implicit : positron.LanguageRuntimeStartupBehavior.Explicit;

        // Customize Jedi LSP entrypoint that adds a resident IPyKernel
        const displayName = interpreter.displayName + (hasKernel ? ' (ipykernel)' : '');
        const command = interpreter.path;
        const pythonVersion = interpreter.version?.raw;
        const lsScriptPath = path.join(EXTENSION_ROOT_DIR, 'pythonFiles', 'positron_language_server.py');
        const args = [command, lsScriptPath, '-f', '{connection_file}', '--logfile', '{log_file}', `--loglevel=${logLevel}`];
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

        // Create a stable ID for the runtime based on the interpreter path and version.
        const digest = crypto.createHash('sha256');
        digest.update(JSON.stringify(kernelSpec));
        digest.update(pythonVersion ?? '');
        const runtimeId = digest.digest('hex').substring(0, 32);

        // Create the metadata for the language runtime
        const metadata: positron.LanguageRuntimeMetadata = {
            runtimePath: interpreter.path,
            runtimeId,
            runtimeName: displayName,
            runtimeVersion: this.extensionVersion ?? '0.0.0',
            runtimeSource: interpreter.envType,
            languageName: kernelSpec.language,
            languageId: PYTHON_LANGUAGE,
            languageVersion: pythonVersion ?? '0.0.0',
            base64EncodedIconSvg,
            inputPrompt: '>>>',
            continuationPrompt: '...',
            startupBehavior
        }

        // Create an adapter for the kernel as our language runtime
        const runtime = new PythonLanguageRuntime(
            kernelSpec, metadata, jupyterAdapterApi, options);

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
            return -semver.compare(av, bv);
        });
        return copy;
    }

    /**
     * Check if a version is supported (i.e. >= the minimum supported version).
     * Also returns true if the version could not be determined.
     */
    private isVersionSupported(version: PythonVersion | undefined): boolean {
        const versionString = version && this.getVersionString(version);
        return !versionString || semver.gte(versionString, this.minimumSupportedVersion);
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private withActiveExtention(ext: vscode.Extension<any>, callback: () => void) {
        if (ext.isActive) {
            callback();
        } else {
            ext.activate().then(callback);
        }
    }
}
