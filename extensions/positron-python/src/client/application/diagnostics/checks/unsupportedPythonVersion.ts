/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Similar to the macPythonInterpreter diagnostic.

// eslint-disable-next-line max-classes-per-file
import { inject, injectable } from 'inversify';
import { DiagnosticSeverity, l10n } from 'vscode';
import { IDisposableRegistry, Resource } from '../../../common/types';
import { IServiceContainer } from '../../../ioc/types';
import { BaseDiagnostic, BaseDiagnosticsService } from '../base';
import { IDiagnosticsCommandFactory } from '../commands/types';
import { DiagnosticCodes } from '../constants';
import { DiagnosticCommandPromptHandlerServiceId, MessageCommandPrompt } from '../promptHandler';
import { DiagnosticScope, IDiagnostic, IDiagnosticCommand, IDiagnosticHandlerService } from '../types';
import { Common } from '../../../common/utils/localize';

const messages = {
    [DiagnosticCodes.UnsupportedPythonVersion]: l10n.t(
        'The selected Python version {0} is not supported. Some features may not work as expected. Select a different session for the best experience.',
    ),
};

export class UnsupportedPythonVersionDiagnostic extends BaseDiagnostic {
    constructor(code: DiagnosticCodes.UnsupportedPythonVersion, resource: Resource, version: string) {
        super(
            code,
            messages[code].format(version),
            DiagnosticSeverity.Error,
            DiagnosticScope.WorkspaceFolder,
            resource,
            true,
            'always',
        );
    }
}

export const UnsupportedPythonVersionServiceId = 'UnsupportedPythonVersionServiceId';

/**
 * Shows the unsupported Python version notification. Python console sessions call `handle` when they start
 * with an unsupported interpreter, so `diagnose` reports nothing during the extension's startup checks.
 */
@injectable()
export class UnsupportedPythonVersionService extends BaseDiagnosticsService {
    constructor(
        @inject(IServiceContainer) serviceContainer: IServiceContainer,
        @inject(IDisposableRegistry) disposableRegistry: IDisposableRegistry,
    ) {
        super([DiagnosticCodes.UnsupportedPythonVersion], serviceContainer, disposableRegistry, true);
    }

    public async diagnose(_resource: Resource): Promise<IDiagnostic[]> {
        return [];
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

    private getCommandPrompts(diagnostic: IDiagnostic): { prompt: string; command?: IDiagnosticCommand }[] {
        const commandFactory = this.serviceContainer.get<IDiagnosticsCommandFactory>(IDiagnosticsCommandFactory);
        switch (diagnostic.code) {
            case DiagnosticCodes.UnsupportedPythonVersion: {
                return [
                    {
                        prompt: Common.selectNewSession,
                        command: commandFactory.createCommand(diagnostic, {
                            type: 'executeVSCCommand',
                            options: 'workbench.action.language.runtime.selectSession',
                        }),
                    },
                    {
                        prompt: Common.doNotShowAgain,
                        command: commandFactory.createCommand(diagnostic, {
                            type: 'ignore',
                            options: DiagnosticScope.WorkspaceFolder,
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
