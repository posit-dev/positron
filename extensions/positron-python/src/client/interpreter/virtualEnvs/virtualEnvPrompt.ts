// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
// --- Start Positron ---
// import { ConfigurationTarget, Disposable, Uri } from 'vscode';
import * as path from 'path';
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

    // --- Start Positron ---
    // Dropped IInterpreterHelper, IPythonPathUpdaterServiceManager, and IInterpreterService: unused
    // now that we start a console session instead of updating pythonPath.
    constructor(
        @inject(IPersistentStateFactory) private readonly persistentStateFactory: IPersistentStateFactory,
        @inject(IDisposableRegistry) private readonly disposableRegistry: Disposable[],
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IComponentAdapter) private readonly pyenvs: IComponentAdapter,
        @inject(IPythonRuntimeManager) private readonly pythonRuntimeManager: IPythonRuntimeManager,
    ) {}
    // --- End Positron ---

    public async activate(resource: Uri): Promise<void> {
        // --- Start Positron ---
        // const disposable = this.pyenvs.onDidCreate(resource, () => this.handleNewEnvironment(resource));
        const disposable = this.pyenvs.onDidCreate(resource, (envPath) => this.handleNewEnvironment(envPath));
        // --- End Positron ---
        this.disposableRegistry.push(disposable);
    }

    @traceDecoratorError('Error in event handler for detection of new environment')
    // --- Start Positron ---
    // Takes the created environment's path instead of the activation resource, skips environments that
    // already have a running console session, and starts a session directly instead of updating pythonPath.
    protected async handleNewEnvironment(envPath: string): Promise<void> {
        if (isCreatingEnvironment()) {
            return;
        }
        if (await this.hasRunningSession(envPath)) {
            return;
        }
        const interpreter = await this.pyenvs.getInterpreterDetails(envPath);
        if (!interpreter) {
            return;
        }
        await this.notifyUser(interpreter);
    }
    // --- End Positron ---

    // --- Start Positron ---
    // A friendly, per-environment label for the prompt message: the environment's folder name
    // (e.g. ".venvA"), falling back to its interpreter path. detailedDisplayName is not used here
    // because two environments on the same Python version share it, and VS Code's notification
    // service collapses notifications with identical message text, silently dropping the earlier
    // prompt.
    private getEnvironmentLabel(interpreter: PythonEnvironment): string {
        if (interpreter.envName) {
            return interpreter.envName;
        }
        if (interpreter.envPath) {
            return path.basename(interpreter.envPath);
        }
        return interpreter.path;
    }
    // --- End Positron ---

    // --- Start Positron ---
    private async hasRunningSession(pythonPath: string): Promise<boolean> {
        const sessions = await getActivePythonSessions();
        return sessions.some((session) => {
            const state = session.getRuntimeState();
            if (state === positron.RuntimeState.Uninitialized || state === positron.RuntimeState.Exited) {
                return false;
            }
            const extraData = session.runtimeMetadata.extraRuntimeData as PythonRuntimeExtraData;
            return arePathsSame(extraData.pythonPath, pythonPath);
        });
    }
    // --- End Positron ---

    // --- Start Positron ---
    // Drops the unused `resource` param, swaps the Yes/No/Ignore prompt for one that names the
    // environment and offers to start a session, and starts the session directly instead of updating
    // pythonPath.
    protected async notifyUser(interpreter: PythonEnvironment): Promise<void> {
        const notificationPromptEnabled = this.persistentStateFactory.createWorkspacePersistentState(
            doNotDisplayPromptStateKey,
            true,
        );
        if (!notificationPromptEnabled.value) {
            return;
        }
        const prompts = [Interpreters.startSession, Common.notNow, Common.doNotShowAgain];
        const telemetrySelections: ['Yes', 'No', 'Ignore'] = ['Yes', 'No', 'Ignore'];
        const selection = await this.appShell.showInformationMessage(
            Interpreters.environmentSessionPromptMessage(this.getEnvironmentLabel(interpreter)),
            ...prompts,
        );
        sendTelemetryEvent(EventName.PYTHON_INTERPRETER_ACTIVATE_ENVIRONMENT_PROMPT, undefined, {
            selection: selection ? telemetrySelections[prompts.indexOf(selection)] : undefined,
        });
        if (!selection) {
            return;
        }
        if (selection === prompts[0]) {
            await this.startSession(interpreter);
        } else if (selection === prompts[2]) {
            await notificationPromptEnabled.updateValue(false);
        }
    }
    // --- End Positron ---

    // --- Start Positron ---
    private async startSession(interpreter: PythonEnvironment): Promise<void> {
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
