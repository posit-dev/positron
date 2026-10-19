// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// --- Start Positron ---
// removed WorkspaceFolder import
import { Disposable, Uri } from 'vscode';
// --- End Positron ---
import {
    fileContainsInlineDependencies,
    hasKnownFiles,
    hasRequirementFiles,
    // --- Start Positron ---
    hasPyprojectToml,
    hasShownCreateEnvModal,
    // --- End Positron ---
    isGlobalPythonSelected,
    shouldPromptToCreateEnv,
    isCreateEnvWorkspaceCheckNotRun,
    disableCreateEnvironmentTrigger,
} from './common/createEnvTriggerUtils';
// --- Start Positron ---
import { getConfiguration, getWorkspaceFolder } from '../../common/vscodeApis/workspaceApis';
// --- End Positron ---
import { traceError, traceInfo } from '../../logging';
import { hasPrefixCondaEnv, hasPixiEnv, hasVenv } from './common/commonUtils';
import { showInformationMessage } from '../../common/vscodeApis/windowApis';
import { Common, CreateEnv } from '../../common/utils/localize';
// --- Start Positron ---
// removed executeCommand import
import { registerCommand } from '../../common/vscodeApis/commandApis';
// --- End Positron ---
import { Commands } from '../../common/constants';
import { Resource } from '../../common/types';
import { sendTelemetryEvent } from '../../telemetry';
import { EventName } from '../../telemetry/constants';
// --- Start Positron ---
import {
    autoCreateVenvWithDeps,
    detectAutoCreateContext,
    describeDepFiles,
    describeTool,
} from './provider/autoCreateVenv';
import { autoSyncUvEnv, autoInstallPixiEnv, showPixiNotInstalledWarning } from './provider/autoCreateLockFileEnv';
import { IPythonRuntimeManager } from '../../positron/manager';
import { IActivatedEnvironmentLaunch } from '../../interpreter/contracts';
import { getPixi } from '../common/environmentManagers/pixi';
import * as path from 'path';
import * as fsapi from '../../common/platform/fs-paths';
// --- End Positron ---

export enum CreateEnvironmentCheckKind {
    /**
     * Checks if environment creation is needed based on file location and content.
     */
    File = 'file',

    /**
     * Checks if environment creation is needed based on workspace contents.
     */
    Workspace = 'workspace',
}

export interface CreateEnvironmentTriggerOptions {
    force?: boolean;
}

// --- Start Positron ---
// Set once in registerCreateEnvironmentTriggers, which runs during activation before any
// check. Both are singletons, so every later check (including reruns) reads the same ones.
let pythonRuntimeManager: IPythonRuntimeManager;
let activatedEnvLaunch: IActivatedEnvironmentLaunch;

/**
 * Shows the auto-create notification and dispatches on the user's response. Shared by the
 * legacy pip-based trigger and the uv.lock/pixi.lock triggers below, which only differ in
 * their message and their "Yes" action.
 */
async function showAutoCreatePrompt(message: string, onYes: () => Promise<void>): Promise<void> {
    // Yield to the interpreter-select modal if it already asked the same question.
    if (hasShownCreateEnvModal()) {
        traceInfo('CreateEnv Trigger - The interpreter-select modal already prompted in this window');
        return;
    }

    traceInfo('CreateEnv Trigger - Prompting to create an environment');
    sendTelemetryEvent(EventName.ENVIRONMENT_CHECK_RESULT, undefined, { result: 'criteria-met' });
    const selection = await showInformationMessage(
        message,
        Common.bannerLabelYes,
        Common.notNow,
        Common.doNotShowAgain,
    );

    if (selection === Common.bannerLabelYes) {
        try {
            await onYes();
        } catch (error) {
            if (error === 'Back' || error === 'Cancel') {
                traceInfo('CreateEnv Trigger - User cancelled auto-create flow');
            } else {
                traceError('CreateEnv Trigger - Error while auto-creating environment: ', error);
            }
        }
    } else if (selection === Common.doNotShowAgain) {
        disableCreateEnvironmentTrigger();
    }
}
// --- End Positron ---

async function createEnvironmentCheckForWorkspace(uri: Uri): Promise<void> {
    const workspace = getWorkspaceFolder(uri);
    if (!workspace) {
        traceInfo(`CreateEnv Trigger - Workspace not found for ${uri.fsPath}`);
        return;
    }
    traceInfo(`CreateEnv Trigger - Checking ${workspace.uri.fsPath}`);

    // --- Start Positron ---
    // Skip showing the Create Environment prompt if one of the following is True:
    // 1. The workspace already has a ".venv" or ".conda" env
    // 2. The workspace does NOT have "requirements.txt", "requirements/*.txt", or "pyproject.toml"
    // 3. The workspace has known files for other environment types like environment.yml, conda.yml, poetry.lock, etc.
    // 4. The selected python is NOT classified as a global python interpreter
    //
    // The startup activated-environment selection writes the interpreter setting a few ms
    // after activation; join it so the gate reads that interpreter, not the stale setting.
    await activatedEnvLaunch.waitForSelection();
    const [
        venvExists,
        condaExists,
        hasReqs,
        hasPyproject,
        knownFiles,
        nonGlobalPython,
        uvLockExists,
        pixiLockExists,
        pixiEnvExists,
    ] = await Promise.all([
        hasVenv(workspace),
        hasPrefixCondaEnv(workspace),
        hasRequirementFiles(workspace),
        hasPyprojectToml(workspace),
        hasKnownFiles(workspace),
        isGlobalPythonSelected(workspace).then((isGlobal) => !isGlobal),
        fsapi.pathExists(path.join(workspace.uri.fsPath, 'uv.lock')),
        fsapi.pathExists(path.join(workspace.uri.fsPath, 'pixi.lock')),
        hasPixiEnv(workspace),
    ]);
    traceInfo(
        `CreateEnv Trigger - Gate for ${workspace.uri.fsPath}: venv=${venvExists} conda=${condaExists} reqs=${hasReqs} ` +
            `pyproject=${hasPyproject} knownFiles=${knownFiles} nonGlobalPython=${nonGlobalPython} ` +
            `uvLock=${uvLockExists} pixiLock=${pixiLockExists} pixiEnv=${pixiEnvExists}`,
    );

    // uv.lock and pixi.lock name an authoritative tool for recreating the exact locked
    // environment, so ask about that tool specifically instead of falling through to the
    // generic pip-based trigger below, which wouldn't honor the lock file. uv may download a
    // Python, so python.allowUvPythonInstall gates the uv prompt as it does elsewhere.
    // A pixi.lock without a .pixi/envs dir always prompts, whatever interpreter is selected
    // or other env files exist, since only pixi can recreate that environment.
    if (pixiLockExists && !pixiEnvExists) {
        const pixi = await getPixi();
        if (pixi) {
            await showAutoCreatePrompt(CreateEnv.Trigger.pixiInstallMessage, () =>
                autoInstallPixiEnv(workspace, pixi, pythonRuntimeManager),
            );
        } else {
            await showPixiNotInstalledWarning();
        }
        return;
    }

    const allowUvPythonInstall = getConfiguration('python').get<boolean>('allowUvPythonInstall') ?? true;
    // A pixi project with an existing pixi env shouldn't get the uv prompt either.
    if (uvLockExists && !pixiLockExists && allowUvPythonInstall && !venvExists && !condaExists && !nonGlobalPython) {
        await showAutoCreatePrompt(CreateEnv.Trigger.uvSyncMessage, () =>
            autoSyncUvEnv(workspace, pythonRuntimeManager),
        );
        return;
    }

    const hasDepFiles = hasReqs || hasPyproject;
    const skipPrompt =
        venvExists ||
        condaExists ||
        !hasDepFiles ||
        knownFiles ||
        nonGlobalPython ||
        // A pixi project with an existing pixi env shouldn't get the pip-based prompt below.
        pixiLockExists;
    // --- End Positron ---

    if (skipPrompt) {
        sendTelemetryEvent(EventName.ENVIRONMENT_CHECK_RESULT, undefined, { result: 'criteria-not-met' });
        traceInfo(`CreateEnv Trigger - Skipping for ${uri.fsPath}`);
        return;
    }

    // --- Start Positron ---
    const ctx = await detectAutoCreateContext(workspace);
    const depFilesLabel = describeDepFiles(ctx);
    const toolLabel = describeTool(ctx);

    await showAutoCreatePrompt(CreateEnv.Trigger.autoCreateMessage(depFilesLabel, toolLabel), async () => {
        await autoCreateVenvWithDeps(workspace, ctx, undefined, pythonRuntimeManager);
    });
    // --- End Positron ---
}

function runOnceWorkspaceCheck(uri: Uri, options: CreateEnvironmentTriggerOptions = {}): Promise<void> {
    if (isCreateEnvWorkspaceCheckNotRun() || options?.force) {
        return createEnvironmentCheckForWorkspace(uri);
    }
    sendTelemetryEvent(EventName.ENVIRONMENT_CHECK_RESULT, undefined, { result: 'already-ran' });
    traceInfo('CreateEnv Trigger - skipping this because it was already run');
    return Promise.resolve();
}

async function createEnvironmentCheckForFile(uri: Uri, options?: CreateEnvironmentTriggerOptions): Promise<void> {
    if (await fileContainsInlineDependencies(uri)) {
        // TODO: Handle create environment for each file here.
        // pending acceptance of PEP-722/PEP-723

        // For now we do the same thing as for workspace.
        await runOnceWorkspaceCheck(uri, options);
    }

    // If the file does not have any inline dependencies, then we do the same thing
    // as for workspace.
    await runOnceWorkspaceCheck(uri, options);
}

export async function triggerCreateEnvironmentCheck(
    kind: CreateEnvironmentCheckKind,
    uri: Resource,
    options?: CreateEnvironmentTriggerOptions,
): Promise<void> {
    if (!uri) {
        sendTelemetryEvent(EventName.ENVIRONMENT_CHECK_RESULT, undefined, { result: 'no-uri' });
        traceInfo('CreateEnv Trigger - Skipping No URI provided');
        return;
    }

    if (shouldPromptToCreateEnv()) {
        if (kind === CreateEnvironmentCheckKind.File) {
            await createEnvironmentCheckForFile(uri, options);
        } else {
            await runOnceWorkspaceCheck(uri, options);
        }
    } else {
        sendTelemetryEvent(EventName.ENVIRONMENT_CHECK_RESULT, undefined, { result: 'turned-off' });
        traceInfo('CreateEnv Trigger - turned off in settings');
    }
}

export function triggerCreateEnvironmentCheckNonBlocking(
    kind: CreateEnvironmentCheckKind,
    uri: Resource,
    options?: CreateEnvironmentTriggerOptions,
): void {
    // The Event loop for Node.js runs functions with setTimeout() with lower priority than setImmediate.
    // This is done to intentionally avoid blocking anything that the user wants to do.
    setTimeout(
        () =>
            triggerCreateEnvironmentCheck(kind, uri, options).catch((err) =>
                traceError('CreateEnv Trigger - Check failed: ', err),
            ),
        0,
    );
}

export function registerCreateEnvironmentTriggers(
    disposables: Disposable[],
    // --- Start Positron ---
    runtimeManager: IPythonRuntimeManager,
    launch: IActivatedEnvironmentLaunch,
    // --- End Positron ---
): void {
    // --- Start Positron ---
    pythonRuntimeManager = runtimeManager;
    activatedEnvLaunch = launch;
    // --- End Positron ---
    disposables.push(
        registerCommand(Commands.Create_Environment_Check, (file: Resource) => {
            sendTelemetryEvent(EventName.ENVIRONMENT_CHECK_TRIGGER, undefined, { trigger: 'as-command' });
            triggerCreateEnvironmentCheckNonBlocking(CreateEnvironmentCheckKind.File, file, { force: true });
        }),
    );
}
