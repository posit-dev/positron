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
    // --- End Positron ---
    isGlobalPythonSelected,
    shouldPromptToCreateEnv,
    isCreateEnvWorkspaceCheckNotRun,
    disableCreateEnvironmentTrigger,
} from './common/createEnvTriggerUtils';
import { getWorkspaceFolder } from '../../common/vscodeApis/workspaceApis';
import { traceError, traceInfo, traceVerbose } from '../../logging';
import { hasPrefixCondaEnv, hasVenv } from './common/commonUtils';
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

async function createEnvironmentCheckForWorkspace(uri: Uri): Promise<void> {
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
    const [venvExists, condaExists, hasReqs, hasPyproject, knownFiles, nonGlobalPython] = await Promise.all([
        hasVenv(workspace),
        hasPrefixCondaEnv(workspace),
        hasRequirementFiles(workspace),
        hasPyprojectToml(workspace),
        hasKnownFiles(workspace),
        isGlobalPythonSelected(workspace).then((isGlobal) => !isGlobal),
    ]);

    const hasDepFiles = hasReqs || hasPyproject;
    const skipPrompt = venvExists || condaExists || !hasDepFiles || knownFiles || nonGlobalPython;
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

    sendTelemetryEvent(EventName.ENVIRONMENT_CHECK_RESULT, undefined, { result: 'criteria-met' });
    const selection = await showInformationMessage(
        CreateEnv.Trigger.autoCreateMessage(depFilesLabel, toolLabel),
        Common.bannerLabelYes,
        Common.notNow,
        Common.doNotShowAgain,
    );

    if (selection === Common.bannerLabelYes) {
        try {
            await autoCreateVenvWithDeps(workspace, ctx);
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
    // --- End Positron ---
}

function runOnceWorkspaceCheck(uri: Uri, options: CreateEnvironmentTriggerOptions = {}): Promise<void> {
    if (isCreateEnvWorkspaceCheckNotRun() || options?.force) {
        return createEnvironmentCheckForWorkspace(uri);
    }
    sendTelemetryEvent(EventName.ENVIRONMENT_CHECK_RESULT, undefined, { result: 'already-ran' });
    traceVerbose('CreateEnv Trigger - skipping this because it was already run');
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
        traceVerbose('CreateEnv Trigger - Skipping No URI provided');
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
        traceVerbose('CreateEnv Trigger - turned off in settings');
    }
}

export function triggerCreateEnvironmentCheckNonBlocking(
    kind: CreateEnvironmentCheckKind,
    uri: Resource,
    options?: CreateEnvironmentTriggerOptions,
): void {
    // The Event loop for Node.js runs functions with setTimeout() with lower priority than setImmediate.
    // This is done to intentionally avoid blocking anything that the user wants to do.
    setTimeout(() => triggerCreateEnvironmentCheck(kind, uri, options).ignoreErrors(), 0);
}

export function registerCreateEnvironmentTriggers(disposables: Disposable[]): void {
    disposables.push(
        registerCommand(Commands.Create_Environment_Check, (file: Resource) => {
            sendTelemetryEvent(EventName.ENVIRONMENT_CHECK_TRIGGER, undefined, { trigger: 'as-command' });
            triggerCreateEnvironmentCheckNonBlocking(CreateEnvironmentCheckKind.File, file, { force: true });
        }),
    );
}
