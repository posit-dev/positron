/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Similar to the macPythonInterpreter diagnostic.

// eslint-disable-next-line max-classes-per-file
import { inject, injectable } from 'inversify';
import { DiagnosticSeverity, l10n } from 'vscode';
import '../../../common/extensions';
import {
    IDisposableRegistry,
    IInterpreterPathService,
    InterpreterConfigurationScope,
    Resource,
} from '../../../common/types';
import { IInterpreterService } from '../../../interpreter/contracts';
import { isVersionSupported } from '../../../interpreter/configuration/environmentTypeComparer';
import { IServiceContainer } from '../../../ioc/types';
import { BaseDiagnostic, BaseDiagnosticsService } from '../base';
import { IDiagnosticsCommandFactory } from '../commands/types';
import { DiagnosticCodes } from '../constants';
import { DiagnosticCommandPromptHandlerServiceId, MessageCommandPrompt } from '../promptHandler';
import { DiagnosticScope, IDiagnostic, IDiagnosticCommand, IDiagnosticHandlerService } from '../types';
import { Common } from '../../../common/utils/localize';

const messages = {
    [DiagnosticCodes.UnsupportedPythonVersion]: l10n.t(
        'The selected Python interpreter version is not supported. Some functionality in the extension will be limited. [Install another version of Python](https://www.python.org/downloads) or select a different interpreter for the best experience.',
    ),
};

export class UnsupportedPythonVersionDiagnostic extends BaseDiagnostic {
    constructor(code: DiagnosticCodes.UnsupportedPythonVersion, resource: Resource) {
        super(code, messages[code], DiagnosticSeverity.Error, DiagnosticScope.WorkspaceFolder, resource);
    }
}

export const UnsupportedPythonVersionServiceId = 'UnsupportedPythonVersionServiceId';

@injectable()
export class UnsupportedPythonVersionService extends BaseDiagnosticsService {
    protected changeThrottleTimeout = 1000;

    private timeOut?: NodeJS.Timeout | number;

    constructor(
        @inject(IServiceContainer) serviceContainer: IServiceContainer,
        @inject(IDisposableRegistry) disposableRegistry: IDisposableRegistry,
    ) {
        super([DiagnosticCodes.UnsupportedPythonVersion], serviceContainer, disposableRegistry, true);
        this.addPythonPathChangedHandler();
    }

    public dispose(): void {
        if (this.timeOut && typeof this.timeOut !== 'number') {
            clearTimeout(this.timeOut);
            this.timeOut = undefined;
        }
    }

    public async diagnose(resource: Resource): Promise<IDiagnostic[]> {
        const interpreterService = this.serviceContainer.get<IInterpreterService>(IInterpreterService);
        const interpreter = await interpreterService.getActiveInterpreter(resource);
        if (isVersionSupported(interpreter?.version)) {
            return [];
        }
        return [new UnsupportedPythonVersionDiagnostic(DiagnosticCodes.UnsupportedPythonVersion, resource)];
    }

    protected async onHandle(diagnostics: IDiagnostic[]): Promise<void> {
        if (diagnostics.length === 0) {
            return;
        }
        const messageService = this.serviceContainer.get<IDiagnosticHandlerService<MessageCommandPrompt>>(
            IDiagnosticHandlerService,
            DiagnosticCommandPromptHandlerServiceId,
        );
        await Promise.all(
            diagnostics.map(async (diagnostic) => {
                const canHandle = await this.canHandle(diagnostic);
                const shouldIgnore = await this.filterService.shouldIgnoreDiagnostic(diagnostic.code);
                if (!canHandle || shouldIgnore) {
                    return;
                }
                const commandPrompts = this.getCommandPrompts(diagnostic);
                await messageService.handle(diagnostic, { commandPrompts, message: diagnostic.message });
            }),
        );
    }

    protected addPythonPathChangedHandler(): void {
        const disposables = this.serviceContainer.get<IDisposableRegistry>(IDisposableRegistry);
        const interpreterPathService = this.serviceContainer.get<IInterpreterPathService>(IInterpreterPathService);
        disposables.push(interpreterPathService.onDidChange((i) => this.onDidChangeConfiguration(i)));
    }

    protected async onDidChangeConfiguration(
        interpreterConfigurationScope: InterpreterConfigurationScope,
    ): Promise<void> {
        const workspaceUri = interpreterConfigurationScope.uri;
        if (this.timeOut && typeof this.timeOut !== 'number') {
            clearTimeout(this.timeOut);
            this.timeOut = undefined;
        }
        this.timeOut = setTimeout(() => {
            this.timeOut = undefined;
            this.diagnose(workspaceUri)
                .then((diagnostics) => this.handle(diagnostics))
                .ignoreErrors();
        }, this.changeThrottleTimeout);
    }

    private getCommandPrompts(diagnostic: IDiagnostic): { prompt: string; command?: IDiagnosticCommand }[] {
        const commandFactory = this.serviceContainer.get<IDiagnosticsCommandFactory>(IDiagnosticsCommandFactory);
        switch (diagnostic.code) {
            case DiagnosticCodes.UnsupportedPythonVersion: {
                return [
                    {
                        prompt: Common.selectPythonInterpreter,
                        command: commandFactory.createCommand(diagnostic, {
                            type: 'executeVSCCommand',
                            options: 'python.setInterpreter',
                        }),
                    },
                    {
                        prompt: Common.doNotShowAgain,
                        command: commandFactory.createCommand(diagnostic, {
                            type: 'ignore',
                            options: DiagnosticScope.Global,
                        }),
                    },
                ];
            }
            default: {
                throw new Error("Invalid diagnostic for 'UnsupportedPythonVersionService'");
            }
        }
    }
}
