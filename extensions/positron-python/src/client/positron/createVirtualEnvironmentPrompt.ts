/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { WorkspaceFolder } from 'vscode';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import { isEnvProviderEnabled } from './createEnvApi';
import { showThreeButtonModalDialogPrompt } from './positronApis';
import { probeExternallyManagedEnvironment } from './externallyManagedEnvironment';
import { CONDA_PROVIDER_ID } from '../pythonEnvironments/creation/provider/condaCreationProvider';
import { UV_PROVIDER_ID } from '../pythonEnvironments/creation/provider/uvCreationProvider';
import { VenvCreationProviderId } from '../pythonEnvironments/creation/provider/venvCreationProvider';
import { isUvInstalled } from '../pythonEnvironments/common/environmentManagers/uv';
import {
    autoCreateVenvWithDeps,
    detectAutoCreateContext,
} from '../pythonEnvironments/creation/provider/autoCreateVenv';
import {
    clearCreateEnvModalShown,
    markCreateEnvModalShown,
} from '../pythonEnvironments/creation/common/createEnvTriggerUtils';
import { Commands } from '../common/constants';
import { getGlobalStorage, IPersistentStorage } from '../common/persistentState';
import { IExtensionContext } from '../common/types';
import { CreateEnv } from '../common/utils/localize';
import { executeCommand } from '../common/vscodeApis/commandApis';
import { getConfiguration, getWorkspaceFolders } from '../common/vscodeApis/workspaceApis';
import { IInterpreterService } from '../interpreter/contracts';
import { isBaseCondaEnvironment } from '../interpreter/configuration/environmentTypeComparer';
import { IServiceContainer } from '../ioc/types';
import { traceError, traceInfo } from '../logging';
import { PythonEnvironment } from '../pythonEnvironments/info';

/** The `python.` prefixed setting that gates the prompt, minus the section name. */
export const PROMPT_ON_INTERPRETER_SELECT_SETTING_PART = 'createEnvironment.promptOnInterpreterSelect';

/** Global storage key holding the interpreter paths the user asked not to be prompted about. */
export const SUPPRESSED_INTERPRETERS_STORAGE_KEY = 'python.createEnvironment.suppressedInterpreters';

/** Everything the provider ladder needs to pick a rung. */
export interface CreateEnvironmentLadderInput {
    /** The interpreter the user picked, used to seed a venv. */
    interpreterPath: string;
    /** The picked interpreter's `major.minor`, or undefined when it is unknown. */
    versionMajorMinor: string | undefined;
    /** Whether the picked interpreter is a conda base environment. */
    isCondaBase: boolean;
    /** Whether uv is installed on the machine. */
    uvInstalled: boolean;
    /** The value of `python.allowUvPythonInstall`. */
    allowUvPythonInstall: boolean;
    /** The single open workspace folder, or undefined in a multi-root workspace. */
    workspaceFolder: WorkspaceFolder | undefined;
}

/**
 * Options for `python.createEnvironment` that create an environment without asking the
 * user to pick a provider, an interpreter, or a version.
 *
 * Returns undefined when no rung is available, which is the signal not to show the
 * prompt at all: there would be nothing actionable to offer.
 */
export function chooseCreateEnvironmentOptions(
    input: CreateEnvironmentLadderInput,
): Record<string, unknown> | undefined {
    // Passing the folder suppresses the flow's own folder pick. In a multi-root
    // workspace let the flow ask which folder to use.
    const base: Record<string, unknown> = input.workspaceFolder ? { workspaceFolder: input.workspaceFolder } : {};

    if (input.isCondaBase && input.versionMajorMinor && isEnvProviderEnabled(CONDA_PROVIDER_ID)) {
        return { ...base, providerId: CONDA_PROVIDER_ID, condaPythonVersion: input.versionMajorMinor };
    }

    // Setting a concrete version makes uv prefer a matching Python it already has.
    // `python.allowUvPythonInstall` still gates the rung because uv downloads a Python
    // when it cannot satisfy the version locally.
    if (
        input.uvInstalled &&
        input.allowUvPythonInstall &&
        input.versionMajorMinor &&
        isEnvProviderEnabled(UV_PROVIDER_ID)
    ) {
        return { ...base, providerId: UV_PROVIDER_ID, uvPythonVersion: input.versionMajorMinor };
    }

    if (isEnvProviderEnabled(VenvCreationProviderId)) {
        return { ...base, providerId: VenvCreationProviderId, interpreterPath: input.interpreterPath };
    }

    return undefined;
}

/** What the caller should do with the session start that triggered the prompt. */
export enum CreateVirtualEnvironmentPromptOutcome {
    /** Start the session as usual. */
    Proceed = 'proceed',
    /** Abort the pending session start. */
    Abort = 'abort',
}

/**
 * Offer to create a virtual environment when the user explicitly picks an
 * externally-managed Python for a console session in a workspace.
 *
 * @param serviceContainer Used for the extension context that backs suppression storage.
 * @param interpreterService Used to resolve the picked interpreter.
 * @param interpreterPath The interpreter the session would start.
 * @param sessionMetadata The metadata for the session being created.
 *
 * @returns Whether the caller should start the session or abort it.
 */
export async function promptToCreateVirtualEnvironment(
    serviceContainer: IServiceContainer,
    interpreterService: IInterpreterService,
    interpreterPath: string,
    sessionMetadata: positron.RuntimeSessionMetadata,
): Promise<CreateVirtualEnvironmentPromptOutcome> {
    if (sessionMetadata.sessionMode !== positron.LanguageRuntimeSessionMode.Console) {
        return CreateVirtualEnvironmentPromptOutcome.Proceed;
    }

    // Only an explicit pick gets the prompt. Automatic, restored, duplicated, and
    // programmatic starts leave this unset.
    if (sessionMetadata.userSelected !== true) {
        return CreateVirtualEnvironmentPromptOutcome.Proceed;
    }

    const workspaceFolders = getWorkspaceFolders();
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return CreateVirtualEnvironmentPromptOutcome.Proceed;
    }

    // Read the setting live so that turning it off takes effect without a reload.
    const pythonConfig = getConfiguration('python');
    if (pythonConfig?.get<boolean>(PROMPT_ON_INTERPRETER_SELECT_SETTING_PART) === false) {
        return CreateVirtualEnvironmentPromptOutcome.Proceed;
    }

    const suppressedInterpreters = getSuppressedInterpreters(serviceContainer);
    if (suppressedInterpreters.get().includes(interpreterPath)) {
        traceInfo(`Create venv prompt - Suppressed for ${interpreterPath}`);
        return CreateVirtualEnvironmentPromptOutcome.Proceed;
    }

    const { externallyManaged, environment } = await probeExternallyManagedEnvironment(
        interpreterPath,
        interpreterService,
    );
    if (!externallyManaged) {
        return CreateVirtualEnvironmentPromptOutcome.Proceed;
    }

    const ladderInput: CreateEnvironmentLadderInput = {
        interpreterPath,
        versionMajorMinor: describeMajorMinor(environment),
        isCondaBase: environment !== undefined && isBaseCondaEnvironment(environment),
        uvInstalled: await isUvInstalled(),
        allowUvPythonInstall: pythonConfig?.get<boolean>('allowUvPythonInstall') ?? true,
        workspaceFolder: workspaceFolders.length === 1 ? workspaceFolders[0] : undefined,
    };
    const createOptions = chooseCreateEnvironmentOptions(ladderInput);
    if (!createOptions) {
        traceInfo('Create venv prompt - No environment provider is available, skipping the prompt');
        return CreateVirtualEnvironmentPromptOutcome.Proceed;
    }

    // Marked before the modal opens so the startup notification cannot race in behind it,
    // and undone again on the dismiss path below.
    markCreateEnvModalShown();

    const choice = await showThreeButtonModalDialogPrompt({
        title: CreateEnv.InterpreterSelect.title,
        message: CreateEnv.InterpreterSelect.message(describeInterpreter(environment, interpreterPath)),
        primaryButtonTitle: CreateEnv.InterpreterSelect.createEnvironment,
        secondaryButtonTitle: CreateEnv.InterpreterSelect.notNow,
        tertiaryButtonTitle: CreateEnv.InterpreterSelect.neverForThisInterpreter,
    });

    if (choice === CreateEnv.InterpreterSelect.createEnvironment) {
        // Not awaited: the create flow registers the new environment and starts its own
        // session, and the pending start this prompt interrupted is aborted below.
        createEnvironment(ladderInput.workspaceFolder, createOptions).catch((error) =>
            traceError(`Create venv prompt - Environment creation failed: ${error}`),
        );
        return CreateVirtualEnvironmentPromptOutcome.Abort;
    }

    if (choice === CreateEnv.InterpreterSelect.neverForThisInterpreter) {
        await suppressedInterpreters.set([...suppressedInterpreters.get(), interpreterPath]);
        return CreateVirtualEnvironmentPromptOutcome.Proceed;
    }

    if (choice === CreateEnv.InterpreterSelect.notNow) {
        return CreateVirtualEnvironmentPromptOutcome.Proceed;
    }

    // Dismissed with the close button or Escape: no session, no create flow. The user did not
    // answer the question, so leave the startup notification free to ask it.
    clearCreateEnvModalShown();
    return CreateVirtualEnvironmentPromptOutcome.Abort;
}

/**
 * Run environment creation.
 *
 * A workspace with dependency files gets the same one-click venv-with-dependencies path
 * the notification prompt offers, so the two prompts do not diverge. The provider the
 * ladder picked is carried into that path, so the dependency files change what is
 * installed, not which Python the environment is built from.
 */
async function createEnvironment(
    workspaceFolder: WorkspaceFolder | undefined,
    createOptions: Record<string, unknown>,
): Promise<void> {
    if (workspaceFolder) {
        const context = await detectAutoCreateContext(workspaceFolder);
        if (context.hasRequirements || context.hasPyprojectToml) {
            await autoCreateVenvWithDeps(workspaceFolder, context, createOptions);
            return;
        }
    }
    await executeCommand(Commands.Create_Environment, createOptions);
}

/** The interpreter paths the user asked not to be prompted about, in global storage. */
function getSuppressedInterpreters(serviceContainer: IServiceContainer): IPersistentStorage<string[]> {
    const context = serviceContainer.get<IExtensionContext>(IExtensionContext);
    return getGlobalStorage<string[]>(context, SUPPRESSED_INTERPRETERS_STORAGE_KEY, []);
}

/** `major.minor` for the picked interpreter, or undefined when the version is unknown. */
function describeMajorMinor(environment: PythonEnvironment | undefined): string | undefined {
    const major = environment?.version?.major;
    const minor = environment?.version?.minor;
    if (major === undefined || minor === undefined || major < 0 || minor < 0) {
        return undefined;
    }
    return `${major}.${minor}`;
}

/** How to name the interpreter in the modal: its display name, or its path. */
function describeInterpreter(environment: PythonEnvironment | undefined, interpreterPath: string): string {
    return environment?.displayName ?? interpreterPath;
}
