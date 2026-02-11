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
import { getUserHomeDir, normalizePath, untildify } from '../../common/utils/pathUtils';
import { isWindows } from '../../common/utils/platformUtils';
import {
    isNativeEnvInfo,
    NativeEnvInfo,
    NativeEnvManagerInfo,
    NativePythonEnvironmentKind,
    NativePythonFinder,
} from '../common/nativePythonFinder';
import { shortVersion, sortEnvironments } from '../common/utils';

async function findPyenv(): Promise<string | undefined> {
    try {
        return await which('pyenv');
    } catch {
        return undefined;
    }
}

export const PYENV_ENVIRONMENTS = 'Environments';
export const PYENV_VERSIONS = 'Versions';

export const PYENV_PATH_KEY = `${ENVS_EXTENSION_ID}:pyenv:PYENV_PATH`;
export const PYENV_WORKSPACE_KEY = `${ENVS_EXTENSION_ID}:pyenv:WORKSPACE_SELECTED`;
export const PYENV_GLOBAL_KEY = `${ENVS_EXTENSION_ID}:pyenv:GLOBAL_SELECTED`;

let pyenvPath: string | undefined;
export async function clearPyenvCache(): Promise<void> {
    pyenvPath = undefined;
}

async function setPyenv(pyenv: string): Promise<void> {
    pyenvPath = pyenv;
    const state = await getWorkspacePersistentState();
    await state.set(PYENV_PATH_KEY, pyenv);
}

export async function getPyenvForGlobal(): Promise<string | undefined> {
    const state = await getWorkspacePersistentState();
    return await state.get(PYENV_GLOBAL_KEY);
}

export async function setPyenvForGlobal(pyenvPath: string | undefined): Promise<void> {
    const state = await getWorkspacePersistentState();
    await state.set(PYENV_GLOBAL_KEY, pyenvPath);
}

export async function getPyenvForWorkspace(fsPath: string): Promise<string | undefined> {
    const state = await getWorkspacePersistentState();
    const data: { [key: string]: string } | undefined = await state.get(PYENV_WORKSPACE_KEY);
    if (data) {
        try {
            return data[fsPath];
        } catch {
            return undefined;
        }
    }
    return undefined;
}

export async function setPyenvForWorkspace(fsPath: string, envPath: string | undefined): Promise<void> {
    const state = await getWorkspacePersistentState();
    const data: { [key: string]: string } = (await state.get(PYENV_WORKSPACE_KEY)) ?? {};
    if (envPath) {
        data[fsPath] = envPath;
    } else {
        delete data[fsPath];
    }
    await state.set(PYENV_WORKSPACE_KEY, data);
}

export async function setPyenvForWorkspaces(fsPath: string[], envPath: string | undefined): Promise<void> {
    const state = await getWorkspacePersistentState();
    const data: { [key: string]: string } = (await state.get(PYENV_WORKSPACE_KEY)) ?? {};
    fsPath.forEach((s) => {
        if (envPath) {
            data[s] = envPath;
        } else {
            delete data[s];
        }
    });
    await state.set(PYENV_WORKSPACE_KEY, data);
}

export async function getPyenv(native?: NativePythonFinder): Promise<string | undefined> {
    if (pyenvPath) {
        if (await fs.exists(untildify(pyenvPath))) {
            return untildify(pyenvPath);
        }
        pyenvPath = undefined;
    }

    const state = await getWorkspacePersistentState();
    const storedPath = await state.get<string>(PYENV_PATH_KEY);
    if (storedPath) {
        if (await fs.exists(untildify(storedPath))) {
            pyenvPath = storedPath;
            traceInfo(`Using pyenv from persistent state: ${pyenvPath}`);
            return untildify(pyenvPath);
        }
        await state.set(PYENV_PATH_KEY, undefined);
    }

    const pyenvBin = isWindows() ? 'pyenv.exe' : 'pyenv';
    const pyenvRoot = process.env.PYENV_ROOT;
    if (pyenvRoot) {
        const pyenvPath = path.join(pyenvRoot, 'bin', pyenvBin);
        if (await fs.exists(pyenvPath)) {
            return pyenvPath;
        }
    }

    const home = getUserHomeDir();
    if (home) {
        const pyenvPath = path.join(home, '.pyenv', 'bin', pyenvBin);
        if (await fs.exists(pyenvPath)) {
            return pyenvPath;
        }

        if (isWindows()) {
            const pyenvPathWin = path.join(home, '.pyenv', 'pyenv-win', 'bin', pyenvBin);
            if (await fs.exists(pyenvPathWin)) {
                return pyenvPathWin;
            }
        }
    }

    pyenvPath = await findPyenv();
    if (pyenvPath) {
        return pyenvPath;
    }

    if (native) {
        const data = await native.refresh(false);
        const managers = data
            .filter((e) => !isNativeEnvInfo(e))
            .map((e) => e as NativeEnvManagerInfo)
            .filter((e) => e.tool.toLowerCase() === 'pyenv');
        if (managers.length > 0) {
            pyenvPath = managers[0].executable;
            traceInfo(`Using pyenv from native finder: ${pyenvPath}`);
            await state.set(PYENV_PATH_KEY, pyenvPath);
            return pyenvPath;
        }
    }

    return undefined;
}

function nativeToPythonEnv(
    info: NativeEnvInfo,
    api: PythonEnvironmentApi,
    manager: EnvironmentManager,
    pyenv: string,
): PythonEnvironment | undefined {
    if (!(info.prefix && info.executable && info.version)) {
        traceError(`Incomplete pyenv environment info: ${JSON.stringify(info)}`);
        return undefined;
    }

    const versionsPath = normalizePath(path.join(path.dirname(path.dirname(pyenv)), 'versions'));
    const envsPaths = normalizePath(path.join(path.dirname(versionsPath), 'envs'));
    let group = undefined;
    const normPrefix = normalizePath(info.prefix);
    if (normPrefix.startsWith(versionsPath)) {
        group = PYENV_VERSIONS;
    } else if (normPrefix.startsWith(envsPaths)) {
        group = PYENV_ENVIRONMENTS;
    }

    const sv = shortVersion(info.version);
    const name = info.name || info.displayName || path.basename(info.prefix);
    let displayName = info.displayName || `pyenv (${sv})`;
    if (info.kind === NativePythonEnvironmentKind.pyenvVirtualEnv) {
        displayName = `${name} (${sv})`;
    }

    const shellActivation: Map<string, PythonCommandRunConfiguration[]> = new Map();
    const shellDeactivation: Map<string, PythonCommandRunConfiguration[]> = new Map();

    shellActivation.set('unknown', [{ executable: 'pyenv', args: ['shell', name] }]);
    shellDeactivation.set('unknown', [{ executable: 'pyenv', args: ['shell', '--unset'] }]);

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
        group: group,
    };

    return api.createPythonEnvironmentItem(environment, manager);
}

export async function refreshPyenv(
    hardRefresh: boolean,
    nativeFinder: NativePythonFinder,
    api: PythonEnvironmentApi,
    manager: EnvironmentManager,
): Promise<PythonEnvironment[]> {
    traceInfo('Refreshing pyenv environments');
    const data = await nativeFinder.refresh(hardRefresh);

    let pyenv = await getPyenv();

    if (pyenv === undefined) {
        const managers = data
            .filter((e) => !isNativeEnvInfo(e))
            .map((e) => e as NativeEnvManagerInfo)
            .filter((e) => e.tool.toLowerCase() === 'pyenv');

        if (managers.length > 0) {
            pyenv = managers[0].executable;
            await setPyenv(pyenv);
        }
    }

    const envs = data
        .filter((e) => isNativeEnvInfo(e))
        .map((e) => e as NativeEnvInfo)
        .filter(
            (e) =>
                e.kind === NativePythonEnvironmentKind.pyenv || e.kind === NativePythonEnvironmentKind.pyenvVirtualEnv,
        );

    const collection: PythonEnvironment[] = [];

    envs.forEach((e) => {
        if (pyenv) {
            const environment = nativeToPythonEnv(e, api, manager, pyenv);
            if (environment) {
                collection.push(environment);
            }
        }
    });

    return sortEnvironments(collection);
}

export async function resolvePyenvPath(
    fsPath: string,
    nativeFinder: NativePythonFinder,
    api: PythonEnvironmentApi,
    manager: EnvironmentManager,
): Promise<PythonEnvironment | undefined> {
    try {
        const e = await nativeFinder.resolve(fsPath);
        if (e.kind !== NativePythonEnvironmentKind.pyenv) {
            return undefined;
        }
        const pyenv = await getPyenv(nativeFinder);
        if (!pyenv) {
            traceError('Pyenv not found while resolving environment');
            return undefined;
        }

        return nativeToPythonEnv(e, api, manager, pyenv);
    } catch {
        return undefined;
    }
}
