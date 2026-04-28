/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as os from 'os';
import { CancellationToken, QuickPickItem, WorkspaceFolder } from 'vscode';
import { execObservable } from '../../../common/process/rawProcessApis';
import { createDeferred } from '../../../common/utils/async';
import { CreateEnv } from '../../../common/utils/localize';
import { traceError, traceLog } from '../../../logging';
import { CreateEnvironmentProgress } from '../types';
import { isUvInstalled } from '../../common/environmentManagers/uv';
import { executeCommand } from '../../../common/vscodeApis/commandApis';
import { showQuickPickWithBack } from '../../../common/vscodeApis/windowApis';
import { Commands } from '../../../common/constants';
import { getPipRequirementsFiles, isPipInstallableToml } from './venvUtils';
import { UV_PROVIDER_ID } from './uvCreationProvider';
import * as fsapi from '../../../common/platform/fs-paths';

export interface AutoCreateVenvContext {
    hasRequirements: boolean;
    hasPyprojectToml: boolean;
    uvAvailable: boolean;
}

export async function detectAutoCreateContext(workspace: WorkspaceFolder): Promise<AutoCreateVenvContext> {
    const tomlPath = path.join(workspace.uri.fsPath, 'pyproject.toml');
    const [reqFiles, uvAvailable, tomlExists] = await Promise.all([
        getPipRequirementsFiles(workspace),
        isUvInstalled(),
        fsapi.pathExists(tomlPath),
    ]);
    let pipInstallableToml = false;
    if (tomlExists) {
        const content = await fsapi.readFile(tomlPath, 'utf-8');
        pipInstallableToml = isPipInstallableToml(content);
    }
    return {
        hasRequirements: (reqFiles?.length ?? 0) > 0,
        hasPyprojectToml: pipInstallableToml,
        uvAvailable,
    };
}

export function describeDepFiles(ctx: AutoCreateVenvContext): string {
    if (ctx.hasRequirements && ctx.hasPyprojectToml) {
        return 'requirements.txt and pyproject.toml';
    }
    if (ctx.hasPyprojectToml) {
        return 'pyproject.toml';
    }
    return 'requirements.txt';
}

export function describeTool(ctx: AutoCreateVenvContext): string {
    return ctx.uvAvailable ? 'uv' : 'venv';
}

interface DepSource {
    label: string;
    args: string[];
}

function reqFileArgs(files: string[]): string[] {
    const args = ['pip', 'install'];
    for (const f of files) {
        args.push('-r', f);
    }
    return args;
}

async function collectDepSources(workspace: WorkspaceFolder): Promise<DepSource[]> {
    const sources: DepSource[] = [];

    const reqFiles = await getPipRequirementsFiles(workspace);
    if (reqFiles && reqFiles.length > 0) {
        for (const f of reqFiles) {
            const relPath = path.relative(workspace.uri.fsPath, f);
            sources.push({
                label: relPath,
                args: reqFileArgs([f]),
            });
        }
    }

    const tomlPath = path.join(workspace.uri.fsPath, 'pyproject.toml');
    if (await fsapi.pathExists(tomlPath)) {
        const content = await fsapi.readFile(tomlPath, 'utf-8');
        if (isPipInstallableToml(content)) {
            sources.push({
                label: 'pyproject.toml',
                args: ['pip', 'install', '-e', '.'],
            });
        }
    }

    return sources;
}

function mergeDepArgs(chosen: DepSource[]): string[] {
    const args = ['pip', 'install'];
    for (const source of chosen) {
        args.push(...source.args.slice(2));
    }
    return args;
}

async function pickDepInstallArgs(sources: DepSource[]): Promise<string[]> {
    if (sources.length === 0) {
        return [];
    }

    if (sources.length === 1) {
        return sources[0].args;
    }

    const items: QuickPickItem[] = sources.map((s) => ({ label: s.label, picked: true }));
    const selection = await showQuickPickWithBack(items, {
        placeHolder: CreateEnv.Trigger.selectDepSource,
        ignoreFocusOut: true,
        canPickMany: true,
    });
    if (!selection || (Array.isArray(selection) && selection.length === 0)) {
        return [];
    }
    const selected = Array.isArray(selection) ? selection : [selection];
    const selectedLabels = new Set(selected.map((s) => s.label));
    const chosen = sources.filter((s) => selectedLabels.has(s.label));
    return chosen.length > 0 ? mergeDepArgs(chosen) : [];
}

/**
 * Install dependencies into an existing uv-managed venv using `uv pip install`.
 * If `depInstallArgs` is provided, uses those directly (pre-resolved by the
 * auto-create flow). Otherwise, resolves which deps to install interactively.
 */
export async function uvInstallDeps(
    workspace: WorkspaceFolder,
    progress: CreateEnvironmentProgress,
    token?: CancellationToken,
    depInstallArgs?: string[],
): Promise<void> {
    progress.report({ message: CreateEnv.Trigger.installingDeps });

    const args = depInstallArgs ?? (await pickDepInstallArgs(await collectDepSources(workspace)));
    if (!args) {
        return;
    }

    const deferred = createDeferred<void>();
    traceLog('Running uv dep install: ', ['uv', ...args]);
    const { proc, out, dispose } = execObservable('uv', args, {
        mergeStdOutErr: true,
        token,
        cwd: workspace.uri.fsPath,
    });

    out.subscribe(
        (value) => {
            const output = value.out.split(/\r?\n/g).join(os.EOL);
            traceLog(output.trimEnd());
        },
        (error) => {
            traceError('Error while installing dependencies via uv: ', error);
            deferred.reject(error);
        },
        () => {
            dispose();
            if (proc?.exitCode !== 0) {
                deferred.reject(`uv pip install failed with exitCode: ${proc?.exitCode}`);
            } else {
                deferred.resolve();
            }
        },
    );
    return deferred.promise;
}

/**
 * Auto-create a venv and install dependencies for a workspace.
 *
 * Routes through the existing Create Environment command so that creation
 * events fire (suppressing the "new venv" notification), the runtime is
 * auto-selected, and dependencies are installed.
 *
 * - uv available: uses the uv provider with auto-selected Python version
 *   and dep installation.
 * - uv not available: opens the standard Create Environment wizard so the
 *   user can pick an interpreter.
 */
export async function autoCreateVenvWithDeps(
    workspace: WorkspaceFolder,
    ctx: AutoCreateVenvContext,
): Promise<string | undefined> {
    // Resolve which deps to install BEFORE creating the venv,
    // so the user can cancel without a venv being created.
    const sources = await collectDepSources(workspace);
    const depArgs = await pickDepInstallArgs(sources);

    const options: Record<string, unknown> = {
        workspaceFolder: workspace,
        installPackages: depArgs.length > 0,
        ignoreSourceControl: true,
        selectEnvironment: true,
    };

    if (depArgs.length > 0) {
        options.depInstallArgs = depArgs;
    }

    if (ctx.uvAvailable) {
        options.providerId = UV_PROVIDER_ID;
        options.uvPythonVersion = 'auto';
    }

    const result = await executeCommand(Commands.Create_Environment, options);
    return (result as { path?: string })?.path;
}
