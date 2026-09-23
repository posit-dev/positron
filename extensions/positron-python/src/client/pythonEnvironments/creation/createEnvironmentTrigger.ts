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
    hasUvLock,
    hasPixiLock,
    // --- End Positron ---
    isGlobalPythonSelected,
    shouldPromptToCreateEnv,
    isCreateEnvWorkspaceCheckNotRun,
    disableCreateEnvironmentTrigger,
} from './common/createEnvTriggerUtils';
import { getWorkspaceFolder } from '../../common/vscodeApis/workspaceApis';
import { traceError, traceInfo, traceVerbose } from '../../logging';
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
import { autoSyncUvEnv, autoInstallPixiEnv } from './provider/autoCreateLockFileEnv';
import { IPythonRuntimeManager } from '../../positron/manager';
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

async function createEnvironmentCheckForWorkspace(
    uri: Uri,
    // --- Start Positron ---
    pythonRuntimeManager?: IPythonRuntimeManager,
    // --- End Positron ---
): Promise<void> {
    const workspace = getWorkspaceFolder(uri);
    if (!workspace) {
        traceInfo(`CreateEnv Trigger - Workspace not found for ${uri.fsPath}`);
        return;
    }

    // --- Start Positron ---
    // Skip showing the Create Environment prompt if one of the following is True:
    // 1. The workspace already has a ".venv" or ".conda" env
    // 2. The workspace does NOT have "requirements.txt", "requirements/*.txt", or "pyproject.toml"
    // 3. The workspace has known files for other environment types like environment.yml, conda.yml, poetry.lock, etc.
    // 4. The selected python is NOT classified as a global python interpreter
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
        hasUvLock(workspace),
        hasPixiLock(workspace),
        hasPixiEnv(workspace),
    ]);

    // uv.lock and pixi.lock name an authoritative tool for recreating the exact locked
    // environment, so ask about that tool specifically instead of falling through to the
    // generic pip-based trigger below, which wouldn't honor the lock file.
    if (pythonRuntimeManager) {
        if (uvLockExists && !venvExists && !condaExists && !nonGlobalPython) {
            await showAutoCreatePrompt(CreateEnv.Trigger.uvSyncMessage, () =>
                autoSyncUvEnv(workspace, pythonRuntimeManager),
            );
            return;
        }

        if (pixiLockExists && !pixiEnvExists && !nonGlobalPython) {
            await showAutoCreatePrompt(CreateEnv.Trigger.pixiInstallMessage, () =>
                autoInstallPixiEnv(workspace, pythonRuntimeManager),
            );
            return;
        }
    }

    const hasDepFiles = hasReqs || hasPyproject;
    const skipPrompt =
        venvExists ||
        condaExists ||
        !hasDepFiles ||
        knownFiles ||
        nonGlobalPython ||
        // A pixi-managed project (an existing pixi env answers for pixi.lock the way venvExists/
        // condaExists answer for the other managers) shouldn't fall through to the wrong,
        // pip-based prompt below. uv.lock does not need the same guard: whenever it's present,
        // the branch above either already handled it or was skipped for a reason (venvExists/
        // condaExists/nonGlobalPython) that independently skips this prompt too.
        (pythonRuntimeManager !== undefined && pixiLockExists);
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
        await autoCreateVenvWithDeps(workspace, ctx);
    });
    // --- End Positron ---
}

function runOnceWorkspaceCheck(
    uri: Uri,
    options: CreateEnvironmentTriggerOptions = {},
    // --- Start Positron ---
    pythonRuntimeManager?: IPythonRuntimeManager,
    // --- End Positron ---
): Promise<void> {
    if (isCreateEnvWorkspaceCheckNotRun() || options?.force) {
        return createEnvironmentCheckForWorkspace(uri, pythonRuntimeManager);
    }
    sendTelemetryEvent(EventName.ENVIRONMENT_CHECK_RESULT, undefined, { result: 'already-ran' });
    traceVerbose('CreateEnv Trigger - skipping this because it was already run');
    return Promise.resolve();
}

async function createEnvironmentCheckForFile(
    uri: Uri,
    options?: CreateEnvironmentTriggerOptions,
    // --- Start Positron ---
    pythonRuntimeManager?: IPythonRuntimeManager,
    // --- End Positron ---
): Promise<void> {
    if (await fileContainsInlineDependencies(uri)) {
        // TODO: Handle create environment for each file here.
        // pending acceptance of PEP-722/PEP-723

        // For now we do the same thing as for workspace.
        await runOnceWorkspaceCheck(uri, options, pythonRuntimeManager);
    }

    // If the file does not have any inline dependencies, then we do the same thing
    // as for workspace.
    await runOnceWorkspaceCheck(uri, options, pythonRuntimeManager);
}

export async function triggerCreateEnvironmentCheck(
    kind: CreateEnvironmentCheckKind,
    uri: Resource,
    options?: CreateEnvironmentTriggerOptions,
    // --- Start Positron ---
    pythonRuntimeManager?: IPythonRuntimeManager,
    // --- End Positron ---
): Promise<void> {
    if (!uri) {
        sendTelemetryEvent(EventName.ENVIRONMENT_CHECK_RESULT, undefined, { result: 'no-uri' });
        traceVerbose('CreateEnv Trigger - Skipping No URI provided');
        return;
    }

    if (shouldPromptToCreateEnv()) {
        if (kind === CreateEnvironmentCheckKind.File) {
            await createEnvironmentCheckForFile(uri, options, pythonRuntimeManager);
        } else {
            await runOnceWorkspaceCheck(uri, options, pythonRuntimeManager);
        }
    } else {
        sendTelemetryEvent(EventName.ENVIRONMENT_CHECK_RESULT, undefined, { result: 'turned-off' });
        traceVerbose('CreateEnv Trigger - turned off in settings');
    }
}

export function triggerCreateEnvironmentCheckNonBlocking(
    kind: CreateEnvironmentCheckKind,
    uri: Resource,
    options?: CreateEnvironmentTriggerOptions,
    // --- Start Positron ---
    pythonRuntimeManager?: IPythonRuntimeManager,
    // --- End Positron ---
): void {
    // The Event loop for Node.js runs functions with setTimeout() with lower priority than setImmediate.
    // This is done to intentionally avoid blocking anything that the user wants to do.
    setTimeout(() => triggerCreateEnvironmentCheck(kind, uri, options, pythonRuntimeManager).ignoreErrors(), 0);
}

export function registerCreateEnvironmentTriggers(
    disposables: Disposable[],
    // --- Start Positron ---
    pythonRuntimeManager: IPythonRuntimeManager,
    // --- End Positron ---
): void {
    disposables.push(
        registerCommand(Commands.Create_Environment_Check, (file: Resource) => {
            sendTelemetryEvent(EventName.ENVIRONMENT_CHECK_TRIGGER, undefined, { trigger: 'as-command' });
            triggerCreateEnvironmentCheckNonBlocking(
                CreateEnvironmentCheckKind.File,
                file,
                { force: true },
                pythonRuntimeManager,
            );
        }),
    );
}
