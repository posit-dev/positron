import * as fs from 'fs-extra';
import * as path from 'path';
import { Uri } from 'vscode';
import which from 'which';
import { EnvironmentManager, PythonEnvironment, PythonEnvironmentApi, PythonEnvironmentInfo } from '../../api';
import { ENVS_EXTENSION_ID } from '../../common/constants';
import { traceError, traceInfo } from '../../common/logging';
import { getWorkspacePersistentState } from '../../common/persistentState';
import { getUserHomeDir, untildify } from '../../common/utils/pathUtils';
import { isWindows } from '../../common/utils/platformUtils';
import {
    isNativeEnvInfo,
    NativeEnvInfo,
    NativeEnvManagerInfo,
    NativePythonEnvironmentKind,
    NativePythonFinder,
} from '../common/nativePythonFinder';
import { getShellActivationCommands, shortVersion, sortEnvironments } from '../common/utils';

async function findPoetry(): Promise<string | undefined> {
    try {
        return await which('poetry');
    } catch {
        return undefined;
    }
}

export const POETRY_GLOBAL = 'Global';

export const POETRY_PATH_KEY = `${ENVS_EXTENSION_ID}:poetry:POETRY_PATH`;
export const POETRY_WORKSPACE_KEY = `${ENVS_EXTENSION_ID}:poetry:WORKSPACE_SELECTED`;
export const POETRY_GLOBAL_KEY = `${ENVS_EXTENSION_ID}:poetry:GLOBAL_SELECTED`;
export const POETRY_VIRTUALENVS_PATH_KEY = `${ENVS_EXTENSION_ID}:poetry:VIRTUALENVS_PATH`;

let poetryPath: string | undefined;
let poetryVirtualenvsPath: string | undefined;

export async function clearPoetryCache(): Promise<void> {
    // Reset in-memory cache
    poetryPath = undefined;
    poetryVirtualenvsPath = undefined;
}

async function setPoetry(poetry: string): Promise<void> {
    poetryPath = poetry;
    const state = await getWorkspacePersistentState();
    await state.set(POETRY_PATH_KEY, poetry);

    // Also get and cache the virtualenvs path
    await getPoetryVirtualenvsPath(poetry);
}

export async function getPoetryForGlobal(): Promise<string | undefined> {
    const state = await getWorkspacePersistentState();
    return await state.get(POETRY_GLOBAL_KEY);
}

export async function setPoetryForGlobal(poetryPath: string | undefined): Promise<void> {
    const state = await getWorkspacePersistentState();
    await state.set(POETRY_GLOBAL_KEY, poetryPath);
}

export async function getPoetryForWorkspace(fsPath: string): Promise<string | undefined> {
    const state = await getWorkspacePersistentState();
    const data: { [key: string]: string } | undefined = await state.get(POETRY_WORKSPACE_KEY);
    if (data) {
        try {
            return data[fsPath];
        } catch {
            return undefined;
        }
    }
    return undefined;
}

export async function setPoetryForWorkspace(fsPath: string, envPath: string | undefined): Promise<void> {
    const state = await getWorkspacePersistentState();
    const data: { [key: string]: string } = (await state.get(POETRY_WORKSPACE_KEY)) ?? {};
    if (envPath) {
        data[fsPath] = envPath;
    } else {
        delete data[fsPath];
    }
    await state.set(POETRY_WORKSPACE_KEY, data);
}

export async function setPoetryForWorkspaces(fsPath: string[], envPath: string | undefined): Promise<void> {
    const state = await getWorkspacePersistentState();
    const data: { [key: string]: string } = (await state.get(POETRY_WORKSPACE_KEY)) ?? {};
    fsPath.forEach((s) => {
        if (envPath) {
            data[s] = envPath;
        } else {
            delete data[s];
        }
    });
    await state.set(POETRY_WORKSPACE_KEY, data);
}

export async function getPoetry(native?: NativePythonFinder): Promise<string | undefined> {
    if (poetryPath) {
        if (await fs.exists(untildify(poetryPath))) {
            return untildify(poetryPath);
        }
        poetryPath = undefined;
    }

    const state = await getWorkspacePersistentState();
    const storedPath = await state.get<string>(POETRY_PATH_KEY);
    if (storedPath) {
        if (await fs.exists(untildify(storedPath))) {
            poetryPath = storedPath;
            traceInfo(`Using poetry from persistent state: ${poetryPath}`);
            // Also retrieve the virtualenvs path if we haven't already
            if (!poetryVirtualenvsPath) {
                getPoetryVirtualenvsPath(untildify(poetryPath)).catch((e) =>
                    traceError(`Error getting Poetry virtualenvs path: ${e}`),
                );
            }
            return untildify(poetryPath);
        }
        await state.set(POETRY_PATH_KEY, undefined);
    }

    // Check in standard PATH locations
    poetryPath = await findPoetry();
    if (poetryPath) {
        await setPoetry(poetryPath);
        return poetryPath;
    }

    // Check for user-installed poetry
    const home = getUserHomeDir();
    if (home) {
        const poetryUserInstall = path.join(
            home,
            isWindows() ? 'AppData\\Roaming\\Python\\Scripts\\poetry.exe' : '.local/bin/poetry',
        );
        if (await fs.exists(poetryUserInstall)) {
            poetryPath = poetryUserInstall;
            await setPoetry(poetryPath);
            return poetryPath;
        }
    }

    if (native) {
        const data = await native.refresh(false);
        const managers = data
            .filter((e) => !isNativeEnvInfo(e))
            .map((e) => e as NativeEnvManagerInfo)
            .filter((e) => e.tool.toLowerCase() === 'poetry');
        if (managers.length > 0) {
            poetryPath = managers[0].executable;
            traceInfo(`Using poetry from native finder: ${poetryPath}`);
            await setPoetry(poetryPath);
            return poetryPath;
        }
    }

    return undefined;
}

export async function getPoetryVirtualenvsPath(poetryExe?: string): Promise<string | undefined> {
    if (poetryVirtualenvsPath) {
        return poetryVirtualenvsPath;
    }

    // Check if we have it in persistent state
    const state = await getWorkspacePersistentState();
    poetryVirtualenvsPath = await state.get<string>(POETRY_VIRTUALENVS_PATH_KEY);
    if (poetryVirtualenvsPath) {
        return untildify(poetryVirtualenvsPath);
    }

    // Try to get it from poetry config
    const poetry = poetryExe || (await getPoetry());
    if (poetry) {
        try {
            const { stdout } = await exec(`"${poetry}" config virtualenvs.path`);
            if (stdout) {
                const venvPath = stdout.trim();
                // Poetry might return the path with placeholders like {cache-dir}
                // If it doesn't start with / or C:\ etc., assume it's using default
                if (!path.isAbsolute(venvPath) || venvPath.includes('{')) {
                    const home = getUserHomeDir();
                    if (home) {
                        poetryVirtualenvsPath = path.join(home, '.cache', 'pypoetry', 'virtualenvs');
                    }
                } else {
                    poetryVirtualenvsPath = venvPath;
                }

                if (poetryVirtualenvsPath) {
                    await state.set(POETRY_VIRTUALENVS_PATH_KEY, poetryVirtualenvsPath);
                    return poetryVirtualenvsPath;
                }
            }
        } catch (e) {
            traceError(`Error getting Poetry virtualenvs path: ${e}`);
        }
    }

    // Fallback to default location
    const home = getUserHomeDir();
    if (home) {
        poetryVirtualenvsPath = path.join(home, '.cache', 'pypoetry', 'virtualenvs');
        await state.set(POETRY_VIRTUALENVS_PATH_KEY, poetryVirtualenvsPath);
        return poetryVirtualenvsPath;
    }

    return undefined;
}

// These are now exported for use in main.ts or environment manager logic
import * as cp from 'child_process';
import { promisify } from 'util';

const exec = promisify(cp.exec);

export async function getPoetryVersion(poetry: string): Promise<string | undefined> {
    try {
        const { stdout } = await exec(`"${poetry}" --version`);
        // Handle both formats:
        // Old: "Poetry version 1.5.1"
        // New: "Poetry (version 2.1.3)"
        traceInfo(`Poetry version output: ${stdout.trim()}`);
        const match = stdout.match(/Poetry (?:version|[\(\s]+version[\s\)]+)([0-9]+\.[0-9]+\.[0-9]+)/i);
        return match ? match[1] : undefined;
    } catch {
        return undefined;
    }
}
async function nativeToPythonEnv(
    info: NativeEnvInfo,
    api: PythonEnvironmentApi,
    manager: EnvironmentManager,
    _poetry: string,
): Promise<PythonEnvironment | undefined> {
    if (!(info.prefix && info.executable && info.version)) {
        traceError(`Incomplete poetry environment info: ${JSON.stringify(info)}`);
        return undefined;
    }

    const sv = shortVersion(info.version);
    const name = info.name || info.displayName || path.basename(info.prefix);
    const displayName = info.displayName || `poetry (${sv})`;

    // Check if this is a global Poetry virtualenv by checking if it's in Poetry's virtualenvs directory
    // We need to use path.normalize() to ensure consistent path format comparison
    const normalizedPrefix = path.normalize(info.prefix);

    // Determine if the environment is in Poetry's global virtualenvs directory
    let isGlobalPoetryEnv = false;
    const virtualenvsPath = poetryVirtualenvsPath; // Use the cached value if available
    if (virtualenvsPath) {
        const normalizedVirtualenvsPath = path.normalize(virtualenvsPath);
        isGlobalPoetryEnv = normalizedPrefix.startsWith(normalizedVirtualenvsPath);
    } else {
        // Fall back to checking the default location if we haven't cached the path yet
        const homeDir = getUserHomeDir();
        if (homeDir) {
            const defaultPath = path.normalize(path.join(homeDir, '.cache', 'pypoetry', 'virtualenvs'));
            isGlobalPoetryEnv = normalizedPrefix.startsWith(defaultPath);

            // Try to get the actual path asynchronously for next time
            getPoetryVirtualenvsPath(_poetry).catch((e) => traceError(`Error getting Poetry virtualenvs path: ${e}`));
        }
    }

    // Get generic python environment info to access shell activation/deactivation commands following Poetry 2.0+ dropping the `shell` command
    const binDir = path.dirname(info.executable);
    const { shellActivation, shellDeactivation } = await getShellActivationCommands(binDir);

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
        group: isGlobalPoetryEnv ? POETRY_GLOBAL : undefined,
    };

    return api.createPythonEnvironmentItem(environment, manager);
}

export async function refreshPoetry(
    hardRefresh: boolean,
    nativeFinder: NativePythonFinder,
    api: PythonEnvironmentApi,
    manager: EnvironmentManager,
): Promise<PythonEnvironment[]> {
    traceInfo('Refreshing poetry environments');
    const data = await nativeFinder.refresh(hardRefresh);

    let poetry = await getPoetry();

    if (poetry === undefined) {
        const managers = data
            .filter((e) => !isNativeEnvInfo(e))
            .map((e) => e as NativeEnvManagerInfo)
            .filter((e) => e.tool.toLowerCase() === 'poetry');
        if (managers.length > 0) {
            poetry = managers[0].executable;
            await setPoetry(poetry);
        }
    }

    if (!poetry) {
        traceInfo('Poetry executable not found');
        return [];
    }

    const envs = data
        .filter((e) => isNativeEnvInfo(e))
        .map((e) => e as NativeEnvInfo)
        .filter((e) => e.kind === NativePythonEnvironmentKind.poetry);

    const collection: PythonEnvironment[] = [];

    await Promise.all(
        envs.map(async (e) => {
            if (poetry) {
                const environment = await nativeToPythonEnv(e, api, manager, poetry);
                if (environment) {
                    collection.push(environment);
                }
            }
        }),
    );

    return sortEnvironments(collection);
}

export async function resolvePoetryPath(
    fsPath: string,
    nativeFinder: NativePythonFinder,
    api: PythonEnvironmentApi,
    manager: EnvironmentManager,
): Promise<PythonEnvironment | undefined> {
    try {
        const e = await nativeFinder.resolve(fsPath);
        if (e.kind !== NativePythonEnvironmentKind.poetry) {
            return undefined;
        }
        const poetry = await getPoetry(nativeFinder);
        if (!poetry) {
            traceError('Poetry not found while resolving environment');
            return undefined;
        }

        return nativeToPythonEnv(e, api, manager, poetry);
    } catch {
        return undefined;
    }
}
