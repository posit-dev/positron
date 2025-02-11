// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Terminal, Uri } from 'vscode';
import { getExtension } from '../common/vscodeApis/extensionsApi';
import {
    GetEnvironmentScope,
    PythonBackgroundRunOptions,
    PythonEnvironment,
    PythonEnvironmentApi,
    PythonProcess,
    RefreshEnvironmentsScope,
} from './types';
import { executeCommand } from '../common/vscodeApis/commandApis';

export const ENVS_EXTENSION_ID = 'ms-python.vscode-python-envs';

let _useExt: boolean | undefined;
export function useEnvExtension(): boolean {
    if (_useExt !== undefined) {
        return _useExt;
    }
    _useExt = !!getExtension(ENVS_EXTENSION_ID);
    return _useExt;
}

let _extApi: PythonEnvironmentApi | undefined;
export async function getEnvExtApi(): Promise<PythonEnvironmentApi> {
    if (_extApi) {
        return _extApi;
    }
    const extension = getExtension(ENVS_EXTENSION_ID);
    if (!extension) {
        throw new Error('Python Environments extension not found.');
    }
    if (extension?.isActive) {
        _extApi = extension.exports as PythonEnvironmentApi;
        return _extApi;
    }

    await extension.activate();

    _extApi = extension.exports as PythonEnvironmentApi;
    return _extApi;
}

export async function runInBackground(
    environment: PythonEnvironment,
    options: PythonBackgroundRunOptions,
): Promise<PythonProcess> {
    const envExtApi = await getEnvExtApi();
    return envExtApi.runInBackground(environment, options);
}

export async function getEnvironment(scope: GetEnvironmentScope): Promise<PythonEnvironment | undefined> {
    const envExtApi = await getEnvExtApi();
    return envExtApi.getEnvironment(scope);
}

export async function refreshEnvironments(scope: RefreshEnvironmentsScope): Promise<void> {
    const envExtApi = await getEnvExtApi();
    return envExtApi.refreshEnvironments(scope);
}

export async function runInTerminal(
    resource: Uri | undefined,
    args?: string[],
    cwd?: string | Uri,
    show?: boolean,
): Promise<Terminal> {
    const envExtApi = await getEnvExtApi();
    const env = await getEnvironment(resource);
    const project = resource ? envExtApi.getPythonProject(resource) : undefined;
    if (env && resource) {
        return envExtApi.runInTerminal(env, {
            cwd: cwd ?? project?.uri ?? process.cwd(),
            args,
            show,
        });
    }
    throw new Error('Invalid arguments to run in terminal');
}

export async function runInDedicatedTerminal(
    resource: Uri | undefined,
    args?: string[],
    cwd?: string | Uri,
    show?: boolean,
): Promise<Terminal> {
    const envExtApi = await getEnvExtApi();
    const env = await getEnvironment(resource);
    const project = resource ? envExtApi.getPythonProject(resource) : undefined;
    if (env) {
        return envExtApi.runInDedicatedTerminal(resource ?? 'global', env, {
            cwd: cwd ?? project?.uri ?? process.cwd(),
            args,
            show,
        });
    }
    throw new Error('Invalid arguments to run in dedicated terminal');
}

export async function clearCache(): Promise<void> {
    const envExtApi = await getEnvExtApi();
    if (envExtApi) {
        await executeCommand('python-envs.clearCache');
    }
}
