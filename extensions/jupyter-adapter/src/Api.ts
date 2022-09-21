/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vscode';
import * as vscode from 'vscode';
import { JupyterKernel, KernelStatus } from './JupyterKernel';
import { discoverAllKernels } from './JupyterKernelDiscovery';
import { JupyterMessage } from './JupyterMessage';
import { MyriacConsolePanel } from './ConsolePanel';

export class Api extends Disposable {
    private _kernels: Map<String, JupyterKernel>;
    private _context: vscode.ExtensionContext;
    private _panels: Map<String, MyriacConsolePanel>;

    public constructor(context: vscode.ExtensionContext) {
        super(() => this.dispose());
        this._context = context;
        this._kernels = new Map<String, JupyterKernel>();
        this._panels = new Map<String, MyriacConsolePanel>();
    }

    public startKernel(spec: JupyterKernelSpec): JupyterKernel {
        console.info(`Starting ${spec.language} kernel '${spec.display_name}'...`);

        // Create new kernel from the spec
        const kernel = new JupyterKernel(spec);

        // Save a reference to the kernel
        this._kernels.set(spec.language, kernel);

        // Start the kernel
        kernel.start();

        // Return the new kernel
        return kernel;
    }

    /**
     * Restarts the active kernel, if a kernel is running.
     */
    public restartKernel() {
        if (this._kernels.size > 0) {
            let kernel: JupyterKernel = this._kernels.values().next().value;
            if (kernel.status() === 'exited') {
                // The kernel is already exited; start it again
                vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `Starting kernel '${kernel.displayName()}'...`
                    },
                    async (progress, token) => {
                        progress.report({ message: 'Restarting kernel...' });
                        return await kernel.start();
                    });
            } else {
                // The kernel is running; shut it down and then start it again
                vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `Restarting kernel '${kernel.displayName()}'...`
                    },
                    async (progress, token) => {
                        progress.report({ message: 'Shutting down kernel...' });
                        return await kernel.restart();
                    });
            }
        } else {
            vscode.window.showErrorMessage('No Myriac kernel is running.');
        }
    }

    /**
     * Shuts down the active kernel, if a kernel is running.
     */
    public shutdownKernel() {
        if (this._kernels.size > 0) {
            let kernel: JupyterKernel = this._kernels.values().next().value;
            vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Shutting down kernel '${kernel.displayName()}'...`
                },
                async (progress, token) => {
                    return new Promise<void>((resolve, reject) => {
                        kernel.shutdown(false);
                        progress.report({ message: 'Awaiting shutdown...' });
                        kernel.once('status', () => {
                            // Resolve promise as soon as kernel status changes
                            resolve();
                        });
                        token.onCancellationRequested(() => {
                            // Reject promise if user cancels
                            reject();
                        });
                    });
                });
        } else {
            vscode.window.showErrorMessage('Can't shut down; no Myriac kernel is running.');
        }
    }

    public interruptKernel() {
        if (this._kernels.size > 0) {
            let kernel: JupyterKernel = this._kernels.values().next().value;
            kernel.interrupt();
        } else {
            vscode.window.showErrorMessage('Can't interrupt; no Myriac kernel is running.');
        }
    }

    /**
     * Create a new Myriac console panel
     */
    public createConsole() {
        // If there's already a kernel running, use that
        if (this._kernels.size > 0) {
            let kernel = this._kernels.values().next().value;
            // Start the kernel if it isn't already running
            if (kernel.status() === 'exited') {
                kernel.start();
            }
            this.createPanel(this._kernels.values().next().value);
            return;
        }

        // Otherwise, start a new kernel of the user's choice
        discoverAllKernels().then(kernels => {
            if (kernels.length === 0) {
                vscode.window.showErrorMessage('No Jupyter kernels were found.');
                return;
            }

            // Create array of Jupyter kernel names
            const options = kernels.map((kernel) => kernel.display_name);

            // Ask the user to select a kernel in which to execute code
            vscode.window.showQuickPick(options).then(display => {
                // No kernel selected
                if (!display) {
                    return;
                }

                // Kernel selected, start it!
                for (const kernel of kernels) {
                    if (kernel.display_name === display) {
                        let jupyter = this.startKernel(kernel);
                        this.createPanel(jupyter);
                        break;
                    }
                }
            });
        });
    }

    /**
     * Starts an LSP for a given language. If a kernel for the language is
     * already running, ask it to start an LSP; if not, start a new kernel.
     *
     * @param language The language to start an LSP for
     * @param address The client address to connect to
     */
    public startLsp(language: string, address: string) {
        if (this._kernels.has(language)) {
            // We have a running kernel for this language; invoke an LSP
            let kernel = this._kernels.get(language)!;
            console.info(`Using running ${language} kernel for LSP.`);
            kernel.startLsp(address);
        } else {
            // We don't have a running kernel for this language; start a new
            // one. This is implicit, so just pick the first kernel that
            // supports the language.
            discoverAllKernels().then(kernels => {
                for (let k of kernels) {
                    if (k.language === language) {
                        let kernel = this.startKernel(k);
                        kernel.on('status', (s: KernelStatus) => {
                            if (s === KernelStatus.ready) {
                                console.info(`Kernel '${k.display_name}' is ready, invoking LSP.`);
                                kernel.startLsp(address);
                            }
                        });
                        break;
                    }
                }
            });
        }
    }

    /**
     * Disposes of all kernels
     */
    public dispose() {
        for (let kernel of this._kernels.values()) {
            kernel.dispose();
        }
        this._kernels.clear();
    }

    /**
     * Creates a new console panel
     *
     * @param kernel The kernel to create a panel for
     */
    private createPanel(kernel: JupyterKernel) {
        // Create a console for the kernel
        let panel = MyriacConsolePanel.create(kernel, this._context.extensionUri, this._context.extensionPath);

        // Save a reference to the panel
        this._panels.set(kernel.spec().language, panel);
    }
}
