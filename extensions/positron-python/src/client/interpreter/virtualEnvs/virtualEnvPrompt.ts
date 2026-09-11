// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
// --- Start Positron ---
// import { ConfigurationTarget, Disposable, Uri } from 'vscode';
import { Disposable, Uri } from 'vscode';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
// --- End Positron ---
import { IExtensionActivationService } from '../../activation/types';
import { IApplicationShell } from '../../common/application/types';
import { IDisposableRegistry, IPersistentStateFactory } from '../../common/types';
import { Common, Interpreters } from '../../common/utils/localize';
// --- Start Positron ---
// import { traceDecoratorError, traceVerbose } from '../../logging';
import { traceDecoratorError, traceError } from '../../logging';
// --- End Positron ---
import { isCreatingEnvironment } from '../../pythonEnvironments/creation/createEnvApi';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { sendTelemetryEvent } from '../../telemetry';
import { EventName } from '../../telemetry/constants';
// --- Start Positron ---
// import { IPythonPathUpdaterServiceManager } from '../configuration/types';
// import { IComponentAdapter, IInterpreterHelper, IInterpreterService } from '../contracts';
import { IComponentAdapter } from '../contracts';
import { IPythonRuntimeManager } from '../../positron/manager';
import { getActivePythonSessions } from '../../positron/session';
import { PythonRuntimeExtraData } from '../../positron/runtime';
import { arePathsSame } from '../../pythonEnvironments/common/externalDependencies';
// --- End Positron ---

const doNotDisplayPromptStateKey = 'MESSAGE_KEY_FOR_VIRTUAL_ENV';
@injectable()
export class VirtualEnvironmentPrompt implements IExtensionActivationService {
    public readonly supportedWorkspaceTypes = { untrustedWorkspace: false, virtualWorkspace: true };

    constructor(
        @inject(IPersistentStateFactory) private readonly persistentStateFactory: IPersistentStateFactory,
        // --- Start Positron ---
        // @inject(IInterpreterHelper) private readonly helper: IInterpreterHelper,
        // @inject(IPythonPathUpdaterServiceManager)
        // private readonly pythonPathUpdaterService: IPythonPathUpdaterServiceManager,
        // --- End Positron ---
        @inject(IDisposableRegistry) private readonly disposableRegistry: Disposable[],
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IComponentAdapter) private readonly pyenvs: IComponentAdapter,
        // --- Start Positron ---
        // @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IPythonRuntimeManager) private readonly pythonRuntimeManager: IPythonRuntimeManager,
        // --- End Positron ---
    ) {}

    public async activate(resource: Uri): Promise<void> {
        // --- Start Positron ---
        // const disposable = this.pyenvs.onDidCreate(resource, () => this.handleNewEnvironment(resource));
        const disposable = this.pyenvs.onDidCreate(resource, (envPath) => this.handleNewEnvironment(envPath));
        // --- End Positron ---
        this.disposableRegistry.push(disposable);
    }

    @traceDecoratorError('Error in event handler for detection of new environment')
    // --- Start Positron ---
    // protected async handleNewEnvironment(resource: Uri): Promise<void> {
    protected async handleNewEnvironment(envPath: string): Promise<void> {
        // --- End Positron ---
        if (isCreatingEnvironment()) {
            return;
        }
        // --- Start Positron ---
        // const interpreters = await this.pyenvs.getWorkspaceVirtualEnvInterpreters(resource);
        // const interpreter =
        //     Array.isArray(interpreters) && interpreters.length > 0
        //         ? this.helper.getBestInterpreter(interpreters)
        //         : undefined;
        // if (!interpreter) {
        //     return;
        // }
        // const currentInterpreter = await this.interpreterService.getActiveInterpreter(resource);
        // if (currentInterpreter?.id === interpreter.id) {
        //     traceVerbose('New environment has already been selected');
        //     return;
        // }
        // await this.notifyUser(interpreter, resource);
        if (await this.hasRunningSession(envPath)) {
            return;
        }
        const interpreter = await this.pyenvs.getInterpreterDetails(envPath);
        if (!interpreter) {
            return;
        }
        await this.notifyUser(interpreter);
        // --- End Positron ---
    }

    // --- Start Positron ---
    private async hasRunningSession(pythonPath: string): Promise<boolean> {
        const sessions = await getActivePythonSessions();
        return sessions.some((session) => {
            if (session.getRuntimeState() === positron.RuntimeState.Exited) {
                return false;
            }
            const extraData = session.runtimeMetadata.extraRuntimeData as PythonRuntimeExtraData;
            return arePathsSame(extraData.pythonPath, pythonPath);
        });
    }
    // --- End Positron ---

    // --- Start Positron ---
    // protected async notifyUser(interpreter: PythonEnvironment, resource: Uri): Promise<void> {
    protected async notifyUser(interpreter: PythonEnvironment): Promise<void> {
        // --- End Positron ---
        const notificationPromptEnabled = this.persistentStateFactory.createWorkspacePersistentState(
            doNotDisplayPromptStateKey,
            true,
        );
        if (!notificationPromptEnabled.value) {
            return;
        }
        // --- Start Positron ---
        // const prompts = [Common.bannerLabelYes, Common.bannerLabelNo, Common.doNotShowAgain];
        const prompts = [Interpreters.startSession, Common.notNow, Common.doNotShowAgain];
        // --- End Positron ---
        const telemetrySelections: ['Yes', 'No', 'Ignore'] = ['Yes', 'No', 'Ignore'];
        // --- Start Positron ---
        // const selection = await this.appShell.showInformationMessage(Interpreters.environmentPromptMessage, ...prompts);
        const selection = await this.appShell.showInformationMessage(
            Interpreters.environmentSessionPromptMessage,
            ...prompts,
        );
        // --- End Positron ---
        sendTelemetryEvent(EventName.PYTHON_INTERPRETER_ACTIVATE_ENVIRONMENT_PROMPT, undefined, {
            selection: selection ? telemetrySelections[prompts.indexOf(selection)] : undefined,
        });
        if (!selection) {
            return;
        }
        if (selection === prompts[0]) {
            // --- Start Positron ---
            // await this.pythonPathUpdaterService.updatePythonPath(
            //     interpreter.path,
            //     ConfigurationTarget.WorkspaceFolder,
            //     'ui',
            //     resource,
            // );
            await this.startSession(interpreter);
            // --- End Positron ---
        } else if (selection === prompts[2]) {
            await notificationPromptEnabled.updateValue(false);
        }
    }

    // --- Start Positron ---
    private async startSession(interpreter: PythonEnvironment): Promise<void> {
        // A session may have started while the notification was open.
        if (await this.hasRunningSession(interpreter.path)) {
            return;
        }
        try {
            const metadata = await this.pythonRuntimeManager.resolveRuntimeMetadataFromPath(interpreter.path);
            if (!metadata) {
                throw new Error(`No runtime could be registered for ${interpreter.path}`);
            }
            await positron.runtime.startLanguageRuntime(metadata.runtimeId, metadata.runtimeName);
        } catch (error) {
            traceError(`Failed to start a console session for ${interpreter.path}`, error);
            this.appShell.showErrorMessage(
                Interpreters.environmentSessionStartFailed(interpreter.detailedDisplayName ?? interpreter.path),
            );
        }
    }
    // --- End Positron ---
}
