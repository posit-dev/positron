/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';
import { CancellationToken, ProgressLocation, WorkspaceFolder } from 'vscode';
import {
    Commands,
    MAXIMUM_PYTHON_VERSION_EXCLUSIVE,
    MINIMUM_PYTHON_VERSION,
    PVSC_EXTENSION_ID,
} from '../../../common/constants';
import { createDeferred } from '../../../common/utils/async';
import { Common, CreateEnv } from '../../../common/utils/localize';
import { traceError, traceInfo, traceLog, traceWarn } from '../../../logging';
import { CreateEnvironmentOptionsInternal, CreateEnvironmentProgress } from '../types';
import { pickWorkspaceFolder } from '../common/workspaceSelection';
import {
    MultiStepAction,
    MultiStepNode,
    showWarningMessage,
    withProgress,
} from '../../../common/vscodeApis/windowApis';
import { getVenvExecutable, showPositronErrorMessageWithLogs } from '../common/commonUtils';
import { ExistingVenvAction, deleteEnvironment, pickExistingVenvAction } from './venvUtils';
import {
    CreateEnvironmentProvider,
    CreateEnvironmentOptions,
    CreateEnvironmentResult,
} from '../proposed.createEnvApis';
import {
    execObservableLocatedUv,
    getStablePythonAfterUpdate,
    getUvPythonVersionInfo,
} from '../../common/environmentManagers/uv';
import { ensureUvInstalledWithProgress } from '../../common/environmentManagers/uvPythonInstaller';
import { pickPythonVersion } from './uvUtils';
import { uvInstallDeps } from './autoCreateVenv';
import { reusedEnvironmentResult } from '../reusedEnvironment';
import { readFile } from '../../common/externalDependencies';
import { PythonVersion } from '../../info/pythonVersion';
import { isVersionSupported, parsePythonVersionFile } from '../../../interpreter/configuration/environmentTypeComparer';

export const UV_PROVIDER_ID = `${PVSC_EXTENSION_ID}:uv`;

/**
 * Returns true when the workspace's `.python-version` names a supported Python as `X.Y` or
 * `X.Y.Z`. Other pins (for example `pypy@3.11`), a missing file, or an unreadable file give false.
 */
async function isSupportedPythonVersionPin(workspacePath: string): Promise<boolean> {
    let content: string;
    try {
        content = await readFile(path.join(workspacePath, '.python-version'));
    } catch {
        return false;
    }
    const match = parsePythonVersionFile(content)?.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
    if (!match) {
        return false;
    }
    return isVersionSupported({
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3] ?? 0),
        raw: match[0],
    } as PythonVersion);
}

/**
 * Runs `uv venv` in the workspace.
 * @param version The Python version to pass with `-p`. When undefined and the workspace's
 *   `.python-version` names a supported version, there is no `-p`, so uv follows that pin
 *   (`-p` wins over `.python-version`). Otherwise `-p` gets the range of supported versions,
 *   and uv picks an interpreter in that range from the user's uv config (for example
 *   `python-preference`).
 */
export async function createUvVenv(
    workspace: WorkspaceFolder,
    version: string | undefined,
    progress: CreateEnvironmentProgress,
    token?: CancellationToken,
    envName?: string,
): Promise<string | undefined> {
    progress.report({
        message: CreateEnv.Venv.creating,
    });
    const targetDir = envName ?? '.venv';
    const argv = ['venv', targetDir, '--no-project', '--seed'];
    if (version) {
        argv.push('-p', version);
    } else if (!(await isSupportedPythonVersionPin(workspace.uri.fsPath))) {
        argv.push('-p', `>=${MINIMUM_PYTHON_VERSION.raw},<${MAXIMUM_PYTHON_VERSION_EXCLUSIVE.raw}`);
    }

    const deferred = createDeferred<string | undefined>();
    traceLog('Running uv venv creation script: ', ['uv', ...argv]);
    const { proc, out, dispose } = await execObservableLocatedUv(argv, {
        mergeStdOutErr: true,
        token,
        cwd: workspace.uri.fsPath,
    });

    const venvPath = `${workspace.uri.fsPath}${
        os.platform() === 'win32' ? `\\${targetDir}\\Scripts\\python.exe` : `/${targetDir}/bin/python`
    }`;

    out.subscribe(
        (value) => {
            const output = value.out.split(/\r?\n/g).join(os.EOL);
            traceLog(output.trimEnd());
        },
        (error) => {
            traceError('Error while running venv creation script: ', error);
            deferred.reject(error);
        },
        () => {
            dispose();
            if (proc?.exitCode !== 0) {
                traceError('Error while running uv environment creation script');
                deferred.reject(`Failed to create virtual environment with exitCode: ${proc?.exitCode}`);
            } else {
                deferred.resolve(venvPath);
            }
        },
    );
    return deferred.promise;
}

export class UvCreationProvider implements CreateEnvironmentProvider {
    public async createEnvironment(
        options?: CreateEnvironmentOptions & CreateEnvironmentOptionsInternal,
    ): Promise<CreateEnvironmentResult | undefined> {
        // Offer to install uv rather than failing, so picking uv works on machines without it.
        // A failed install shows its own error; a declined one ends quietly.
        if (!(await ensureUvInstalledWithProgress()).ok) {
            return undefined;
        }

        let workspace: WorkspaceFolder | undefined;
        const workspaceStep = new MultiStepNode(
            undefined,
            async (context?: MultiStepAction) => {
                try {
                    workspace = (await pickWorkspaceFolder(
                        { preSelectedWorkspace: options?.workspaceFolder },
                        context,
                    )) as WorkspaceFolder | undefined;
                } catch (ex) {
                    if (ex === MultiStepAction.Back || ex === MultiStepAction.Cancel) {
                        return ex;
                    }
                    throw ex;
                }

                if (workspace === undefined) {
                    traceError('Workspace was not selected or found for creating uv environment.');
                    return MultiStepAction.Cancel;
                }
                traceInfo(`Selected workspace ${workspace.uri.fsPath} for creating uv environment.`);
                return MultiStepAction.Continue;
            },
            undefined,
        );

        let existingVenvAction: ExistingVenvAction | undefined;
        const existingEnvStep = new MultiStepNode(
            workspaceStep,
            async (context?: MultiStepAction) => {
                if (workspace && context === MultiStepAction.Continue) {
                    try {
                        existingVenvAction = await pickExistingVenvAction(workspace);
                        return MultiStepAction.Continue;
                    } catch (ex) {
                        if (ex === MultiStepAction.Back || ex === MultiStepAction.Cancel) {
                            return ex;
                        }
                        throw ex;
                    }
                } else if (context === MultiStepAction.Back) {
                    return MultiStepAction.Back;
                }
                return MultiStepAction.Continue;
            },
            undefined,
        );
        workspaceStep.next = existingEnvStep;

        let version: string | undefined;
        // 'auto' lets uv pick the interpreter from a supported .python-version pin, or else from
        // the supported range and the user's uv config (for example python-preference =
        // "only-system"). See #16343.
        let letUvPickVersion = false;
        let installDeps = options?.installPackages ?? false;
        const versionStep = new MultiStepNode(
            workspaceStep,
            async (context) => {
                if (existingVenvAction === ExistingVenvAction.Create && options?.uvPythonVersion === 'auto') {
                    letUvPickVersion = true;
                    traceInfo('Letting uv pick the Python version for the uv environment.');
                } else if (existingVenvAction === ExistingVenvAction.Create && options?.uvPythonVersion) {
                    version = options.uvPythonVersion;
                } else if (
                    existingVenvAction === ExistingVenvAction.Recreate ||
                    existingVenvAction === ExistingVenvAction.Create
                ) {
                    try {
                        version = await pickPythonVersion(undefined, workspace?.uri.fsPath);
                    } catch (ex) {
                        if (ex === MultiStepAction.Back || ex === MultiStepAction.Cancel) {
                            return ex;
                        }
                        throw ex;
                    }
                    if (version === undefined) {
                        traceError('Python version was not selected for creating uv environment.');
                        return MultiStepAction.Cancel;
                    }
                    traceInfo(`Selected Python version ${version} for creating uv environment.`);
                } else if (existingVenvAction === ExistingVenvAction.UseExisting) {
                    if (context === MultiStepAction.Back) {
                        return MultiStepAction.Back;
                    }
                }

                return MultiStepAction.Continue;
            },
            undefined,
        );
        existingEnvStep.next = versionStep;

        const action = await MultiStepNode.run(workspaceStep);
        if (action === MultiStepAction.Back || action === MultiStepAction.Cancel) {
            throw action;
        }

        if (workspace) {
            if (existingVenvAction === ExistingVenvAction.Recreate) {
                traceInfo(`Recreating existing virtual environment in ${workspace.uri.fsPath}`);
                if (await deleteEnvironment(workspace, undefined)) {
                    traceInfo(`Deleted existing virtual environment`);
                } else {
                    traceError(`Failed to delete existing virtual environment`);
                    throw MultiStepAction.Cancel;
                }
            } else if (existingVenvAction === ExistingVenvAction.UseExisting) {
                traceInfo(`Using existing virtual environment in ${workspace.uri.fsPath}`);
                return reusedEnvironmentResult(getVenvExecutable(workspace), workspace);
            }
        }

        const createEnvInternal = async (progress: CreateEnvironmentProgress, token: CancellationToken) => {
            progress.report({
                message: CreateEnv.statusStarting,
            });

            let envPath: string | undefined;
            try {
                if (!workspace) {
                    throw new Error('Failed to create uv environment. Workspace is undefined.');
                }

                if (!version && !letUvPickVersion) {
                    throw new Error('Failed to create uv environment. Python version is undefined.');
                }

                // Check if uv would install a pre-release version and warn the user
                const versionInfo = version ? await getUvPythonVersionInfo(version) : undefined;
                if (version && versionInfo?.isPrerelease) {
                    traceWarn(
                        `uv would install pre-release Python ${versionInfo.version} for requested version ${version}`,
                    );
                    const choice = await showWarningMessage(
                        CreateEnv.Uv.prereleaseWarning(versionInfo.version),
                        { modal: false },
                        CreateEnv.Uv.updateUv,
                        CreateEnv.Uv.proceedAnyway,
                        Common.cancel,
                    );

                    if (choice === CreateEnv.Uv.updateUv) {
                        const result = await getStablePythonAfterUpdate(version, (message) => {
                            progress.report({ message });
                        });

                        if (!result.success) {
                            if (result.error === 'update_failed') {
                                throw new Error(CreateEnv.Uv.errorUpdatingUv);
                            } else if (result.error === 'install_failed') {
                                throw new Error(CreateEnv.Uv.errorInstallingPython(result.version ?? version));
                            } else {
                                throw new Error(CreateEnv.Uv.noStableVersionAvailable(version));
                            }
                        }

                        traceInfo(`Using stable Python ${result.version}`);
                        version = result.version;
                    } else if (choice !== CreateEnv.Uv.proceedAnyway) {
                        // User cancelled or closed the dialog
                        return undefined;
                    }
                    traceInfo(`Proceeding with Python ${version}`);
                }

                envPath = await createUvVenv(workspace, version, progress, token, options?.envName);
                if (envPath) {
                    if (installDeps && workspace) {
                        try {
                            await uvInstallDeps(workspace, progress, token, options?.depInstallArgs);
                        } catch (depEx) {
                            if (depEx === MultiStepAction.Back || depEx === MultiStepAction.Cancel) {
                                traceInfo('User skipped dependency installation.');
                            } else {
                                traceError('Dependency installation failed, but venv was created: ', depEx);
                                showPositronErrorMessageWithLogs(CreateEnv.Venv.errorInstallingPackages);
                            }
                        }
                    }
                    return { path: envPath, workspaceFolder: workspace };
                }

                throw new Error('Failed to create uv environment. See Output > Python for more info.');
            } catch (ex) {
                traceError(ex);
                showPositronErrorMessageWithLogs(CreateEnv.Venv.errorCreatingEnvironment);
                return { error: ex as Error };
            }
        };

        return withProgress(
            {
                location: ProgressLocation.Notification,
                title: `${CreateEnv.statusTitle} ([${Common.showLogs}](command:${Commands.ViewOutput}))`,
                cancellable: true,
            },
            async (
                progress: CreateEnvironmentProgress,
                token: CancellationToken,
            ): Promise<CreateEnvironmentResult | undefined> => createEnvInternal(progress, token),
        );
    }

    name = 'uv';

    description: string = CreateEnv.Uv.providerDescription;

    id = UV_PROVIDER_ID;

    tools = ['uv'];
}
