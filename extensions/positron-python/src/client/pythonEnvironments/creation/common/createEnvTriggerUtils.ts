// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// --- Start Positron ---
import * as os from 'os';
import { isPipInstallableToml } from '../provider/venvUtils';
// --- End Positron ---
import * as path from 'path';
import { ConfigurationTarget, Uri, WorkspaceFolder } from 'vscode';
import * as fsapi from '../../../common/platform/fs-paths';
import { getPipRequirementsFiles } from '../provider/venvUtils';
import { getExtension } from '../../../common/vscodeApis/extensionsApi';
import { PVSC_EXTENSION_ID } from '../../../common/constants';
import { PythonExtension } from '../../../api/types';
import { traceVerbose } from '../../../logging';
import { getConfiguration } from '../../../common/vscodeApis/workspaceApis';
import { getWorkspaceStateValue } from '../../../common/persistentState';

export const CREATE_ENV_TRIGGER_SETTING_PART = 'createEnvironment.trigger';
export const CREATE_ENV_TRIGGER_SETTING = `python.${CREATE_ENV_TRIGGER_SETTING_PART}`;

export async function fileContainsInlineDependencies(_uri: Uri): Promise<boolean> {
    // This is a placeholder for the real implementation of inline dependencies support
    // For now we don't detect anything. Once PEP-722/PEP-723 are accepted we can implement
    // this properly.
    return false;
}

export async function hasRequirementFiles(workspace: WorkspaceFolder): Promise<boolean> {
    const files = await getPipRequirementsFiles(workspace);
    const found = (files?.length ?? 0) > 0;
    if (found) {
        traceVerbose(`Found requirement files: ${workspace.uri.fsPath}`);
    }
    return found;
}

// --- Start Positron ---
export async function hasPyprojectToml(workspace: WorkspaceFolder): Promise<boolean> {
    const tomlPath = path.join(workspace.uri.fsPath, 'pyproject.toml');
    if (!(await fsapi.pathExists(tomlPath))) {
        return false;
    }
    const content = await fsapi.readFile(tomlPath, 'utf-8');
    const installable = isPipInstallableToml(content);
    if (installable) {
        traceVerbose(`Found pip-installable pyproject.toml: ${workspace.uri.fsPath}`);
    }
    return installable;
}

// --- End Positron ---
export async function hasKnownFiles(workspace: WorkspaceFolder): Promise<boolean> {
    const filePaths: string[] = [
        'poetry.lock',
        'conda.yaml',
        'environment.yaml',
        'conda.yml',
        'environment.yml',
        'Pipfile',
        'Pipfile.lock',
    ].map((fileName) => path.join(workspace.uri.fsPath, fileName));
    const result = await Promise.all(filePaths.map((f) => fsapi.pathExists(f)));
    const found = result.some((r) => r);
    if (found) {
        traceVerbose(`Found known files: ${workspace.uri.fsPath}`);
    }
    return found;
}

export async function isGlobalPythonSelected(workspace: WorkspaceFolder): Promise<boolean> {
    const extension = getExtension<PythonExtension>(PVSC_EXTENSION_ID);
    if (!extension) {
        return false;
    }
    const extensionApi: PythonExtension = extension.exports as PythonExtension;
    const interpreter = extensionApi.environments.getActiveEnvironmentPath(workspace.uri);
    const details = await extensionApi.environments.resolveEnvironment(interpreter);
    // --- Start Positron ---
    const execPath = details?.executable?.uri?.fsPath ?? interpreter.path;
    // Also treat ~/.local installs as global - they are user-wide, not project-local.
    const homeLocal = path.join(os.homedir(), '.local') + path.sep;
    const isUnderHomeLocal = execPath.startsWith(homeLocal);
    const isGlobal = details?.environment === undefined || isUnderHomeLocal;
    // --- End Positron ---
    if (isGlobal) {
        traceVerbose(`Selected python for [${workspace.uri.fsPath}] is [global] type: ${interpreter.path}`);
    }
    return isGlobal;
}

/**
 * Checks the setting `python.createEnvironment.trigger` to see if we should perform the checks
 * to prompt to create an environment.
 * Returns True if we should prompt to create an environment.
 */
export function shouldPromptToCreateEnv(): boolean {
    const config = getConfiguration('python');
    if (config) {
        const value = config.get<string>(CREATE_ENV_TRIGGER_SETTING_PART, 'off');
        return value !== 'off';
    }

    return getWorkspaceStateValue<string>(CREATE_ENV_TRIGGER_SETTING, 'off') !== 'off';
}

/**
 * Sets `python.createEnvironment.trigger` to 'off' in the user settings.
 */
export function disableCreateEnvironmentTrigger(): void {
    const config = getConfiguration('python');
    if (config) {
        config.update('createEnvironment.trigger', 'off', ConfigurationTarget.Global);
    }
}

let _alreadyCreateEnvCriteriaCheck = false;
/**
 * Run-once wrapper function for the workspace check to prompt to create an environment.
 * @returns : True if we should prompt to c environment.
 */
export function isCreateEnvWorkspaceCheckNotRun(): boolean {
    if (_alreadyCreateEnvCriteriaCheck) {
        return false;
    }
    _alreadyCreateEnvCriteriaCheck = true;
    return true;
}

// --- Start Positron ---
// Positron has two create-environment prompts: this notification and the modal shown when
// the user explicitly picks an externally-managed interpreter. They ask the same question,
// so the notification stands down once the modal has asked it. The flag only ever gates the
// notification: an explicit interpreter pick is a direct user action and always deserves a
// response, even if the notification went by earlier in the window.
//
// This is deliberately not a per-window cap on the modal itself. Suppressing every later
// pick would mean answering for interpreters the user was never asked about; declining a
// prompt for one interpreter says nothing about the next one. Repeat prompts for the same
// interpreter are what "Never for This Interpreter" is for.
//
// `_alreadyCreateEnvCriteriaCheck` above cannot serve the purpose: it is set when the check
// runs, not when a prompt is shown.
let _createEnvModalShown = false;

/** True when the interpreter-select modal has asked about creating an environment. */
export function hasShownCreateEnvModal(): boolean {
    return _createEnvModalShown;
}

/**
 * Record that the interpreter-select modal is asking about creating an environment.
 *
 * Called before the modal opens rather than after it closes, so the notification cannot race
 * in behind an open modal.
 */
export function markCreateEnvModalShown(): void {
    _createEnvModalShown = true;
}

/**
 * Undo `markCreateEnvModalShown`.
 *
 * For the dismiss path: a user who closes the modal without answering has not settled the
 * question, so the notification is still free to ask it.
 */
export function clearCreateEnvModalShown(): void {
    _createEnvModalShown = false;
}
// --- End Positron ---
