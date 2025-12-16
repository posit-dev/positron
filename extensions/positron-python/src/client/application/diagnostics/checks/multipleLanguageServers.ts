/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line max-classes-per-file
import { inject, injectable, named } from 'inversify';
import { DiagnosticSeverity } from 'vscode';
import { IExtensions, IDisposableRegistry, Resource } from '../../../common/types';
import { Common, LanguageService } from '../../../common/utils/localize';
import { IServiceContainer } from '../../../ioc/types';
import { BaseDiagnostic, BaseDiagnosticsService } from '../base';
import { IDiagnosticsCommandFactory } from '../commands/types';
import { DiagnosticCodes } from '../constants';
import { DiagnosticCommandPromptHandlerServiceId, MessageCommandPrompt } from '../promptHandler';
import { DiagnosticScope, IDiagnostic, IDiagnosticHandlerService } from '../types';

/**
 * List of known Python language server extension IDs.
 * These extensions may conflict with each other when multiple are enabled.
 */
const LANGUAGE_SERVER_EXTENSION_IDS = [
    'astral-sh.ty',
    'detachhead.basedpyright',
    'kv9898.basedpyright',
    'meta.pyrefly',
    'ms-pyright.pyright',
    'zuban.zubanls',
];

export class MultipleLanguageServersDiagnostic extends BaseDiagnostic {
    constructor(message: string, resource: Resource) {
        super(
            DiagnosticCodes.MultipleLanguageServersDiagnostic,
            message,
            DiagnosticSeverity.Error,
            DiagnosticScope.Global,
            resource,
        );
    }
}

export const MultipleLanguageServersDiagnosticServiceId = 'MultipleLanguageServersDiagnosticServiceId';

@injectable()
export class MultipleLanguageServersDiagnosticService extends BaseDiagnosticsService {
    protected changeThrottleTimeout = 1000;

    private timeOut?: NodeJS.Timeout | number;

    constructor(
        @inject(IServiceContainer) serviceContainer: IServiceContainer,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IDiagnosticHandlerService)
        @named(DiagnosticCommandPromptHandlerServiceId)
        protected readonly messageService: IDiagnosticHandlerService<MessageCommandPrompt>,
        @inject(IDisposableRegistry) disposableRegistry: IDisposableRegistry,
    ) {
        super([DiagnosticCodes.MultipleLanguageServersDiagnostic], serviceContainer, disposableRegistry, true, true);
        this.addExtensionChangeHandler();
    }

    public dispose(): void {
        if (this.timeOut) {
            clearTimeout(this.timeOut);
            this.timeOut = undefined;
        }
    }

    public async diagnose(resource: Resource): Promise<IDiagnostic[]> {
        const detectedExtensions = this.getDetectedLanguageServers();
        if (detectedExtensions.length < 2) {
            return [];
        }

        const extensionList = detectedExtensions.join('", "');
        const message = LanguageService.multipleLanguageServersWarning.format(extensionList);
        return [new MultipleLanguageServersDiagnostic(message, resource)];
    }

    protected async onHandle(diagnostics: IDiagnostic[]): Promise<void> {
        if (diagnostics.length === 0 || !this.canHandle(diagnostics[0])) {
            return;
        }

        const diagnostic = diagnostics[0];
        if (await this.filterService.shouldIgnoreDiagnostic(diagnostic.code)) {
            return;
        }

        const commandFactory = this.serviceContainer.get<IDiagnosticsCommandFactory>(IDiagnosticsCommandFactory);
        const options = [
            {
                prompt: Common.viewExtensions,
                command: commandFactory.createCommand(diagnostic, {
                    type: 'executeVSCCommand',
                    options: 'workbench.view.extensions',
                }),
            },
            {
                prompt: Common.doNotShowAgain,
                command: commandFactory.createCommand(diagnostic, { type: 'ignore', options: DiagnosticScope.Global }),
            },
        ];

        await this.messageService.handle(diagnostic, {
            commandPrompts: options,
        });
    }

    private getDetectedLanguageServers(): string[] {
        const detected: string[] = [];

        for (const extensionId of LANGUAGE_SERVER_EXTENSION_IDS) {
            // VS Code's getExtension is case-insensitive by default
            const extension = this.extensions.getExtension(extensionId);
            if (extension !== undefined) {
                detected.push(extensionId);
            }
        }

        return detected;
    }

    protected addExtensionChangeHandler(): void {
        const disposables = this.serviceContainer.get<IDisposableRegistry>(IDisposableRegistry);
        disposables.push(this.extensions.onDidChange(() => this.onDidChangeExtensions()));
    }

    protected async onDidChangeExtensions(): Promise<void> {
        if (this.timeOut) {
            clearTimeout(this.timeOut);
            this.timeOut = undefined;
        }
        this.timeOut = setTimeout(() => {
            this.timeOut = undefined;
            this.diagnose(undefined)
                .then((diagnostics) => this.handle(diagnostics))
                .ignoreErrors();
        }, this.changeThrottleTimeout);
    }
}
