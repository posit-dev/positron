// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import '../../common/extensions';
import { Disposable, LanguageClient, LanguageClientOptions } from 'vscode-languageclient/node';

// --- Start Positron ---
import * as path from 'path';
import { EXTENSION_ROOT_DIR } from '../../common/constants';
import { ChildProcess, spawn, SpawnOptions } from 'child_process';
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
import { traceDecoratorError, traceDecoratorVerbose, traceError, traceInfo, traceVerbose } from '../../logging';
// --- End Positron ---

export class JediLanguageServerProxy implements ILanguageServerProxy {
    private languageClient: LanguageClient | undefined;
    // --- Start Positron ---
    private serverProcess: ChildProcess | undefined;
    // --- End Positron ---
    private readonly disposables: Disposable[] = [];

    private lsVersion: string | undefined;

    // --- Start Positron ---
    constructor(
        private readonly interpreterService: IInterpreterService,
        private readonly factory: JediLanguageClientFactory
    ) { }
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
            const port = await this.startLSPAndKernel(resource, interpreter);
            const client = await this.factory.createLanguageClientTCP(port, options);
            // TODO: Ask Jupyter Adapter to attach to our kernel
            // --- End Positron ---
            this.registerHandlers(client);
            await client.start();
            this.languageClient = client;
        } catch (ex) {
            traceError('Failed to start language server:', ex);
            throw new Error('Launching Jedi language server using python failed, see output.');
        }
    }

    // --- Start Positron ---
    /**
     * Finds an available port and starts a Jedi LSP as a TCP server, including an IPyKernel.
     */
    private async startLSPAndKernel(resource: Resource, _interpreter: PythonEnvironment | undefined): Promise<number> {

        // Find an available port for our TCP server
        const portfinder = require('portfinder');
        const port = await portfinder.getPortPromise();

        // For now, match vscode behavior and always look up the active interpreter each time
        const interpreter = await this.interpreterService.getActiveInterpreter(resource);
        const command = interpreter ? interpreter.path : 'python';

        // Customize Jedi entrypoint with an additional resident IPyKernel
        const lsScriptPath = path.join(EXTENSION_ROOT_DIR, 'pythonFiles', 'ipykernel_jedi.py');
        const args = [lsScriptPath, `--port=${port}`] // '-f', '{ connection_file }']
        traceVerbose(`Configuring Jedi LSP server with args '${args}'`);

        // Spawn Jedi LSP in TCP mode
        const options: SpawnOptions = { env: {} };
        const process: ChildProcess = spawn(command, args, options);
        if (!process || !process.pid) {
            return Promise.reject(`Failed to spawn Jedi LSP server using command '${command}' with args '${args}'.`);
        }

        // Wait for spawn to complete
        await new Promise((resolve) => {
            process.once('spawn', () => { resolve(true); });
        });
        traceInfo(`Spawned Jedi LSP on port '${port}' with pid '${process.pid}'`);
        this.serverProcess = process;

        return port;
    }

    @traceDecoratorVerbose('Stopping language server')
    public async stop(): Promise<void> {
        while (this.disposables.length > 0) {
            const d = this.disposables.shift()!;
            d.dispose();
        }

        // --- Start Positron ---
        // If we spawned our own process, stop it
        if (this.serverProcess?.pid) {
            try {
                killPid(this.serverProcess.pid);
            } catch (ex) {
                traceError('Stopping Jedi language server failed', ex);
            }
        }
        // --- End Positron ---

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
