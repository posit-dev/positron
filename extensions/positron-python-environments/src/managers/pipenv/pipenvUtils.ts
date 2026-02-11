// Utility functions for Pipenv environment management

import * as fs from 'fs-extra';
import * as path from 'path';
import { Uri } from 'vscode';
import which from 'which';
import {
    EnvironmentManager,
    PythonCommandRunConfiguration,
    PythonEnvironment,
    PythonEnvironmentApi,
    PythonEnvironmentInfo,
} from '../../api';
import { ENVS_EXTENSION_ID } from '../../common/constants';
import { traceError, traceInfo } from '../../common/logging';
import { getWorkspacePersistentState } from '../../common/persistentState';
import { untildify } from '../../common/utils/pathUtils';
import { getSettingWorkspaceScope } from '../../features/settings/settingHelpers';
import {
    isNativeEnvInfo,
    NativeEnvInfo,
    NativeEnvManagerInfo,
    NativePythonEnvironmentKind,
    NativePythonFinder,
} from '../common/nativePythonFinder';
import { getShellActivationCommands, shortVersion } from '../common/utils';

export const PIPENV_PATH_KEY = `${ENVS_EXTENSION_ID}:pipenv:PIPENV_PATH`;
export const PIPENV_WORKSPACE_KEY = `${ENVS_EXTENSION_ID}:pipenv:WORKSPACE_SELECTED`;
export const PIPENV_GLOBAL_KEY = `${ENVS_EXTENSION_ID}:pipenv:GLOBAL_SELECTED`;

let pipenvPath: string | undefined;

async function findPipenv(): Promise<string | undefined> {
    try {
        return await which('pipenv');
    } catch {
        return undefined;
    }
}

async function setPipenv(pipenv: string): Promise<void> {
    pipenvPath = pipenv;
    const state = await getWorkspacePersistentState();
    await state.set(PIPENV_PATH_KEY, pipenv);
}

export async function clearPipenvCache(): Promise<void> {
    pipenvPath = undefined;
}

function getPipenvPathFromSettings(): string | undefined {
    const pipenvPath = getSettingWorkspaceScope<string>('python', 'pipenvPath');
    return pipenvPath ? pipenvPath : undefined;
}

export async function getPipenv(native?: NativePythonFinder): Promise<string | undefined> {
    if (pipenvPath) {
        if (await fs.exists(untildify(pipenvPath))) {
            return untildify(pipenvPath);
        }
        pipenvPath = undefined;
    }

    const state = await getWorkspacePersistentState();
    const storedPath = await state.get<string>(PIPENV_PATH_KEY);
    if (storedPath) {
        if (await fs.exists(untildify(storedPath))) {
            pipenvPath = storedPath;
            traceInfo(`Using pipenv from persistent state: ${pipenvPath}`);
            return untildify(pipenvPath);
        }
        await state.set(PIPENV_PATH_KEY, undefined);
    }

    // try to get from settings
    const settingPath = getPipenvPathFromSettings();
    if (settingPath) {
        if (await fs.exists(untildify(settingPath))) {
            pipenvPath = settingPath;
            traceInfo(`Using pipenv from settings: ${settingPath}`);
            return untildify(pipenvPath);
        }
        traceInfo(`Pipenv path from settings does not exist: ${settingPath}`);
    }

    // Try to find pipenv in PATH
    const foundPipenv = await findPipenv();
    if (foundPipenv) {
        pipenvPath = foundPipenv;
        traceInfo(`Found pipenv in PATH: ${foundPipenv}`);
        return foundPipenv;
    }

    // Use native finder as fallback
    if (native) {
        const data = await native.refresh(false);
        const managers = data
            .filter((e) => !isNativeEnvInfo(e))
            .map((e) => e as NativeEnvManagerInfo)
            .filter((e) => e.tool.toLowerCase() === 'pipenv');
        if (managers.length > 0) {
            pipenvPath = managers[0].executable;
            traceInfo(`Using pipenv from native finder: ${pipenvPath}`);
            await state.set(PIPENV_PATH_KEY, pipenvPath);
            return pipenvPath;
        }
    }

    traceInfo('Pipenv not found');
    return undefined;
}

async function nativeToPythonEnv(
    info: NativeEnvInfo,
    api: PythonEnvironmentApi,
    manager: EnvironmentManager,
): Promise<PythonEnvironment | undefined> {
    if (!(info.prefix && info.executable && info.version)) {
        traceError(`Incomplete pipenv environment info: ${JSON.stringify(info)}`);
        return undefined;
    }

    const sv = shortVersion(info.version);
    const folderName = path.basename(info.prefix);
    const name = info.name || info.displayName || folderName;
    const displayName = info.displayName || `${folderName} (${sv})`;

    // Derive the environment's bin/scripts directory from the python executable
    const binDir = path.dirname(info.executable);
    let shellActivation: Map<string, PythonCommandRunConfiguration[]> = new Map();
    let shellDeactivation: Map<string, PythonCommandRunConfiguration[]> = new Map();

    try {
        const maps = await getShellActivationCommands(binDir);
        shellActivation = maps.shellActivation;
        shellDeactivation = maps.shellDeactivation;
    } catch (ex) {
        traceError(`Failed to compute shell activation commands for pipenv at ${binDir}: ${ex}`);
    }

    const environment: PythonEnvironmentInfo = {
        name: name,
        displayName: displayName,
        shortDisplayName: displayName,
        displayPath: info.prefix,
        version: info.version,
        environmentPath: Uri.file(info.prefix),
        description: undefined,
        tooltip: info.prefix,
        execInfo: {
            run: { executable: info.executable },
            shellActivation,
            shellDeactivation,
        },
        sysPrefix: info.prefix,
    };

    return api.createPythonEnvironmentItem(environment, manager);
}

export async function refreshPipenv(
    hardRefresh: boolean,
    nativeFinder: NativePythonFinder,
    api: PythonEnvironmentApi,
    manager: EnvironmentManager,
): Promise<PythonEnvironment[]> {
    traceInfo('Refreshing pipenv environments');

    const searchPath = getPipenvPathFromSettings();
    const data = await nativeFinder.refresh(hardRefresh, searchPath ? [Uri.file(searchPath)] : undefined);

    let pipenv = await getPipenv();

    if (pipenv === undefined) {
        const managers = data
            .filter((e) => !isNativeEnvInfo(e))
            .map((e) => e as NativeEnvManagerInfo)
            .filter((e) => e.tool.toLowerCase() === 'pipenv');

        if (managers.length > 0) {
            pipenv = managers[0].executable;
            await setPipenv(pipenv);
        }
    }

    const envs = data
        .filter((e) => isNativeEnvInfo(e))
        .map((e) => e as NativeEnvInfo)
        .filter((e) => e.kind === NativePythonEnvironmentKind.pipenv);

    const collection: PythonEnvironment[] = [];

    for (const e of envs) {
        if (pipenv) {
            const environment = await nativeToPythonEnv(e, api, manager);
            if (environment) {
                collection.push(environment);
            }
        }
    }

    traceInfo(`Found ${collection.length} pipenv environments`);
    return collection;
}

export async function resolvePipenvPath(
    fsPath: string,
    nativeFinder: NativePythonFinder,
    api: PythonEnvironmentApi,
    manager: EnvironmentManager,
): Promise<PythonEnvironment | undefined> {
    const resolved = await nativeFinder.resolve(fsPath);

    if (resolved.kind === NativePythonEnvironmentKind.pipenv) {
        const pipenv = await getPipenv(nativeFinder);
        if (pipenv) {
            return await nativeToPythonEnv(resolved, api, manager);
        }
    }

    return undefined;
}

// Persistence functions for workspace/global environment selection
export async function getPipenvForGlobal(): Promise<string | undefined> {
    const state = await getWorkspacePersistentState();
    return await state.get(PIPENV_GLOBAL_KEY);
}

export async function setPipenvForGlobal(pipenvPath: string | undefined): Promise<void> {
    const state = await getWorkspacePersistentState();
    await state.set(PIPENV_GLOBAL_KEY, pipenvPath);
}

export async function getPipenvForWorkspace(fsPath: string): Promise<string | undefined> {
    const state = await getWorkspacePersistentState();
    const data: { [key: string]: string } | undefined = await state.get(PIPENV_WORKSPACE_KEY);
    if (data) {
        try {
            return data[fsPath];
        } catch {
            return undefined;
        }
    }
    return undefined;
}

export async function setPipenvForWorkspace(fsPath: string, envPath: string | undefined): Promise<void> {
    const state = await getWorkspacePersistentState();
    const data: { [key: string]: string } = (await state.get(PIPENV_WORKSPACE_KEY)) ?? {};
    if (envPath) {
        data[fsPath] = envPath;
    } else {
        delete data[fsPath];
    }
    await state.set(PIPENV_WORKSPACE_KEY, data);
}

export async function setPipenvForWorkspaces(fsPath: string[], envPath: string | undefined): Promise<void> {
    const state = await getWorkspacePersistentState();
    const data: { [key: string]: string } = (await state.get(PIPENV_WORKSPACE_KEY)) ?? {};
    fsPath.forEach((s) => {
        if (envPath) {
            data[s] = envPath;
        } else {
            delete data[s];
        }
    });
    await state.set(PIPENV_WORKSPACE_KEY, data);
}
