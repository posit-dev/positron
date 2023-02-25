// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { JediLanguageServerAnalysisOptions } from '../activation/jedi/analysisOptions';
import { JediLanguageClientFactory } from '../activation/jedi/languageClientFactory';
import { JediLanguageServerProxy } from '../activation/jedi/languageServerProxy';
import { JediLanguageServerManager } from '../activation/jedi/manager';
// --- Start Positron ---
import * as vscode from 'vscode';
import { ILanguageServerOutputChannel, ILanguageServerProxy } from '../activation/types';
import { PositronJediLanguageServerProxy } from '../activation/jedi/positronLanguageRuntimes';
// --- End Positron ---
import { IWorkspaceService, ICommandManager } from '../common/application/types';
import {
    IExperimentService,
    IInterpreterPathService,
    IConfigurationService,
    Resource,
    IDisposable,
} from '../common/types';
import { IEnvironmentVariablesProvider } from '../common/variables/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IServiceContainer } from '../ioc/types';
import { traceError } from '../logging';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { ILanguageServerExtensionManager } from './types';

export class JediLSExtensionManager implements IDisposable, ILanguageServerExtensionManager {
    private serverProxy: ILanguageServerProxy;

    serverManager: JediLanguageServerManager;

    clientFactory: JediLanguageClientFactory;

    analysisOptions: JediLanguageServerAnalysisOptions;

    constructor(
        serviceContainer: IServiceContainer,
        outputChannel: ILanguageServerOutputChannel,
        _experimentService: IExperimentService,
        workspaceService: IWorkspaceService,
        configurationService: IConfigurationService,
        _interpreterPathService: IInterpreterPathService,
        interpreterService: IInterpreterService,
        environmentService: IEnvironmentVariablesProvider,
        commandManager: ICommandManager,
    ) {
        this.analysisOptions = new JediLanguageServerAnalysisOptions(
            environmentService,
            outputChannel,
            configurationService,
            workspaceService,
        );
        this.clientFactory = new JediLanguageClientFactory(interpreterService);
        // --- Start Positron ---
        const ext = vscode.extensions.getExtension('vscode.jupyter-adapter');
        if (ext) {
            this.serverProxy = new PositronJediLanguageServerProxy(serviceContainer, interpreterService);
        } else {
            this.serverProxy = new JediLanguageServerProxy(this.clientFactory);
        }
        // --- End Positron ---
        this.serverManager = new JediLanguageServerManager(
            serviceContainer,
            this.analysisOptions,
            this.serverProxy,
            commandManager,
        );
    }

    dispose(): void {
        this.serverManager.disconnect();
        this.serverManager.dispose();
        this.serverProxy.dispose();
        this.analysisOptions.dispose();
    }

    async startLanguageServer(resource: Resource, interpreter?: PythonEnvironment): Promise<void> {
        await this.serverManager.start(resource, interpreter);
        this.serverManager.connect();
    }

    async stopLanguageServer(): Promise<void> {
        this.serverManager.disconnect();
        await this.serverProxy.stop();
    }

    // eslint-disable-next-line class-methods-use-this
    canStartLanguageServer(interpreter: PythonEnvironment | undefined): boolean {
        if (!interpreter) {
            traceError('Unable to start Jedi language server as a valid interpreter is not selected');
            return false;
        }
        // Otherwise return true for now since it's shipped with the extension.
        // Update this when JediLSP is pulled in a separate extension.
        return true;
    }

    // eslint-disable-next-line class-methods-use-this
    languageServerNotAvailable(): Promise<void> {
        // Nothing to do here.
        // Update this when JediLSP is pulled in a separate extension.
        return Promise.resolve();
    }
}
