// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as path from 'path';
import { Disposable, Event, EventEmitter, Uri, WorkspaceFoldersChangeEvent } from 'vscode';
// eslint-disable-next-line import/no-duplicates
import { PythonEnvInfo, PythonEnvKind, PythonEnvType, PythonVersion } from './base/info';
import {
    GetRefreshEnvironmentsOptions,
    IDiscoveryAPI,
    ProgressNotificationEvent,
    ProgressReportStage,
    PythonLocatorQuery,
    TriggerRefreshOptions,
} from './base/locator';
import { PythonEnvCollectionChangedEvent } from './base/watcher';
import {
    getAdditionalEnvDirs,
    isNativeEnvInfo,
    NativeEnvInfo,
    NativeEnvManagerInfo,
    NativePythonFinder,
} from './base/locators/common/nativePythonFinder';
import { createDeferred, Deferred } from '../common/utils/async';
import { Architecture, getPathEnvVariable, getUserHomeDir } from '../common/utils/platform';
import { parseVersion } from './base/info/pythonVersion';
import { cache } from '../common/utils/decorators';
import { traceError, traceInfo, traceLog, traceVerbose, traceWarn } from '../logging';
import { StopWatch } from '../common/utils/stopWatch';
import { FileChangeType } from '../common/platform/fileSystemWatcher';
import { categoryToKind, NativePythonEnvironmentKind } from './base/locators/common/nativePythonUtils';
import { getCondaEnvDirs, getCondaPathSetting, setCondaBinary } from './common/environmentManagers/conda';
import { setPyEnvBinary } from './common/environmentManagers/pyenv';
import {
    createPythonWatcher,
    PythonGlobalEnvEvent,
    PythonWorkspaceEnvEvent,
} from './base/locators/common/pythonWatcher';
import { getWorkspaceFolders, onDidChangeWorkspaceFolders } from '../common/vscodeApis/workspaceApis';

// --- Start Positron ---
import { getUvDirs, isUvEnvironment } from './common/environmentManagers/uv';
import { isCustomEnvironment } from '../positron/interpreterSettings';
import { isAdditionalGlobalBinPath } from './common/environmentManagers/globalInstalledEnvs';
// eslint-disable-next-line import/no-duplicates
import { PythonEnvSource } from './base/info';
import { getShortestString } from '../common/stringUtils';
import { arePathsSame, isParentPath, resolveSymbolicLink } from './common/externalDependencies';
// --- End Positron ---

function makeExecutablePath(prefix?: string): string {
    if (!prefix) {
        return process.platform === 'win32' ? 'python.exe' : 'python';
    }
    return process.platform === 'win32' ? path.join(prefix, 'python.exe') : path.join(prefix, 'python');
}

function toArch(a: string | undefined): Architecture {
    switch (a) {
        case 'x86':
            return Architecture.x86;
        case 'x64':
            return Architecture.x64;
        default:
            return Architecture.Unknown;
    }
}

function getLocation(nativeEnv: NativeEnvInfo, executable: string): string {
    if (nativeEnv.kind === NativePythonEnvironmentKind.Conda) {
        return nativeEnv.prefix ?? path.dirname(executable);
    }

    if (nativeEnv.executable) {
        return nativeEnv.executable;
    }

    if (nativeEnv.prefix) {
        return nativeEnv.prefix;
    }

    // This is a path to a generated executable. Needed for backwards compatibility.
    return executable;
}

function kindToShortString(kind: PythonEnvKind): string | undefined {
    switch (kind) {
        case PythonEnvKind.Poetry:
            return 'poetry';
        case PythonEnvKind.Pyenv:
            return 'pyenv';
        case PythonEnvKind.VirtualEnv:
        case PythonEnvKind.Venv:
        case PythonEnvKind.VirtualEnvWrapper:
        case PythonEnvKind.OtherVirtual:
            return 'venv';
        case PythonEnvKind.Pipenv:
            return 'pipenv';
        case PythonEnvKind.Conda:
            return 'conda';
        case PythonEnvKind.ActiveState:
            return 'active-state';
        case PythonEnvKind.MicrosoftStore:
            return 'Microsoft Store';
        case PythonEnvKind.Hatch:
            return 'hatch';
        case PythonEnvKind.Pixi:
            return 'pixi';
        // --- Start Positron ---
        case PythonEnvKind.Uv:
            return 'uv';
        // --- End Positron ---
        case PythonEnvKind.System:
        case PythonEnvKind.Unknown:
        case PythonEnvKind.OtherGlobal:
        case PythonEnvKind.Custom:
        default:
            return undefined;
    }
}

function toShortVersionString(version: PythonVersion): string {
    return `${version.major}.${version.minor}.${version.micro}`.trim();
}

function getDisplayName(version: PythonVersion, kind: PythonEnvKind, arch: Architecture, name?: string): string {
    const versionStr = toShortVersionString(version);
    const kindStr = kindToShortString(kind);
    if (arch === Architecture.x86) {
        if (kindStr) {
            return name ? `Python ${versionStr} 32-bit (${name})` : `Python ${versionStr} 32-bit (${kindStr})`;
        }
        return name ? `Python ${versionStr} 32-bit (${name})` : `Python ${versionStr} 32-bit`;
    }
    if (kindStr) {
        return name ? `Python ${versionStr} (${name})` : `Python ${versionStr} (${kindStr})`;
    }
    return name ? `Python ${versionStr} (${name})` : `Python ${versionStr}`;
}

function validEnv(nativeEnv: NativeEnvInfo): boolean {
    if (nativeEnv.prefix === undefined && nativeEnv.executable === undefined) {
        traceError(`Invalid environment [native]: ${JSON.stringify(nativeEnv)}`);
        return false;
    }
    return true;
}

function getEnvType(kind: PythonEnvKind): PythonEnvType | undefined {
    switch (kind) {
        // --- Start Positron ---
        // The only Positron change here is adding uv, but this fence can't be in the middle
        case PythonEnvKind.Uv:
        case PythonEnvKind.Poetry:
        case PythonEnvKind.Pyenv:
        case PythonEnvKind.VirtualEnv:
        case PythonEnvKind.Venv:
        case PythonEnvKind.VirtualEnvWrapper:
        case PythonEnvKind.OtherVirtual:
        case PythonEnvKind.Pipenv:
        case PythonEnvKind.ActiveState:
        case PythonEnvKind.Hatch:
        case PythonEnvKind.Pixi:
            // --- End Positron ---
            return PythonEnvType.Virtual;

        case PythonEnvKind.Conda:
            return PythonEnvType.Conda;

        case PythonEnvKind.System:
        case PythonEnvKind.Unknown:
        case PythonEnvKind.OtherGlobal:
        case PythonEnvKind.Custom:
        case PythonEnvKind.MicrosoftStore:
        default:
            return undefined;
    }
}

function isSubDir(pathToCheck: string | undefined, parents: string[]): boolean {
    return parents.some((prefix) => {
        if (pathToCheck) {
            return path.normalize(pathToCheck).startsWith(path.normalize(prefix));
        }
        return false;
    });
}

function foundOnPath(fsPath: string): boolean {
    const paths = getPathEnvVariable().map((p) => path.normalize(p).toLowerCase());
    const normalized = path.normalize(fsPath).toLowerCase();
    return paths.some((p) => normalized.includes(p));
}

// --- Start Positron ---
// added async
async function getName(nativeEnv: NativeEnvInfo, kind: PythonEnvKind, condaEnvDirs: string[]): Promise<string> {
    // --- End Positron ---
    if (nativeEnv.name) {
        return nativeEnv.name;
    }

    // --- Start Positron ---
    if (nativeEnv.prefix && kind === PythonEnvKind.Uv) {
        // If it's a uv-managed interpreter, we don't need a name
        const uvDirs = await getUvDirs();
        for (const uvDir of uvDirs) {
            if (isParentPath(nativeEnv.prefix, uvDir)) {
                return '';
            }
        }

        // It's a venv - return the name of the venv's parent folder
        return path.basename(path.dirname(nativeEnv.prefix));
    }
    // --- End Positron ---

    const envType = getEnvType(kind);
    if (nativeEnv.prefix && envType === PythonEnvType.Virtual) {
        return path.basename(nativeEnv.prefix);
    }

    if (nativeEnv.prefix && envType === PythonEnvType.Conda) {
        if (nativeEnv.name === 'base') {
            return 'base';
        }

        const workspaces = (getWorkspaceFolders() ?? []).map((wf) => wf.uri.fsPath);
        if (isSubDir(nativeEnv.prefix, workspaces)) {
            traceInfo(`Conda env is --prefix environment: ${nativeEnv.prefix}`);
            return '';
        }

        if (condaEnvDirs.length > 0 && isSubDir(nativeEnv.prefix, condaEnvDirs)) {
            traceInfo(`Conda env is --named environment: ${nativeEnv.prefix}`);
            return path.basename(nativeEnv.prefix);
        }
    }

    return '';
}

// --- Start Positron ---
// added async
async function toPythonEnvInfo(nativeEnv: NativeEnvInfo, condaEnvDirs: string[]): Promise<PythonEnvInfo | undefined> {
    // --- End Positron ---
    if (!validEnv(nativeEnv)) {
        return undefined;
    }
    const kind = categoryToKind(nativeEnv.kind);
    const arch = toArch(nativeEnv.arch);
    const version: PythonVersion = parseVersion(nativeEnv.version ?? '');
    // --- Start Positron ---
    // added await
    const name = await getName(nativeEnv, kind, condaEnvDirs);
    // --- End Positron ---
    const displayName = nativeEnv.version
        ? getDisplayName(version, kind, arch, name)
        : nativeEnv.displayName ?? 'Python';

    const executable = nativeEnv.executable ?? makeExecutablePath(nativeEnv.prefix);
    return {
        name,
        location: getLocation(nativeEnv, executable),
        kind,
        id: executable,
        executable: {
            filename: executable,
            sysPrefix: nativeEnv.prefix ?? '',
            ctime: -1,
            mtime: -1,
        },
        version: {
            sysVersion: nativeEnv.version,
            major: version.major,
            minor: version.minor,
            micro: version.micro,
        },
        arch,
        distro: {
            org: '',
        },
        // --- Start Positron ---
        source: nativeEnv.source ?? [],
        // --- End Positron ---
        detailedDisplayName: displayName,
        display: displayName,
        type: getEnvType(kind),
    };
}

function hasChanged(old: PythonEnvInfo, newEnv: PythonEnvInfo): boolean {
    if (old.name !== newEnv.name) {
        return true;
    }
    if (old.executable.filename !== newEnv.executable.filename) {
        return true;
    }
    if (old.version.major !== newEnv.version.major) {
        return true;
    }
    if (old.version.minor !== newEnv.version.minor) {
        return true;
    }
    if (old.version.micro !== newEnv.version.micro) {
        return true;
    }
    if (old.location !== newEnv.location) {
        return true;
    }
    if (old.kind !== newEnv.kind) {
        return true;
    }
    if (old.arch !== newEnv.arch) {
        return true;
    }

    return false;
}

// --- Start Positron ---
enum ExistingEnvAction {
    KeepExistingEnv,
    AddNewEnv,
    ReplaceExistingEnv,
}

type ExistingEnvResult =
    | {
          reason: ExistingEnvAction.KeepExistingEnv;
          existingEnv: PythonEnvInfo;
      }
    | {
          reason: ExistingEnvAction.AddNewEnv;
          existingEnv: undefined;
      }
    | {
          reason: ExistingEnvAction.ReplaceExistingEnv;
          existingEnv: PythonEnvInfo;
      };
// --- End Positron ---

class NativePythonEnvironments implements IDiscoveryAPI, Disposable {
    private _onProgress: EventEmitter<ProgressNotificationEvent>;

    private _onChanged: EventEmitter<PythonEnvCollectionChangedEvent>;

    private _refreshPromise?: Deferred<void>;

    private _envs: PythonEnvInfo[] = [];

    private _disposables: Disposable[] = [];

    private _condaEnvDirs: string[] = [];

    constructor(private readonly finder: NativePythonFinder) {
        this._onProgress = new EventEmitter<ProgressNotificationEvent>();
        this._onChanged = new EventEmitter<PythonEnvCollectionChangedEvent>();

        this.onProgress = this._onProgress.event;
        this.onChanged = this._onChanged.event;

        this.refreshState = ProgressReportStage.idle;
        this._disposables.push(this._onProgress, this._onChanged);

        this.initializeWatcher();
    }

    dispose(): void {
        this._disposables.forEach((d) => d.dispose());
    }

    refreshState: ProgressReportStage;

    onProgress: Event<ProgressNotificationEvent>;

    onChanged: Event<PythonEnvCollectionChangedEvent>;

    getRefreshPromise(_options?: GetRefreshEnvironmentsOptions): Promise<void> | undefined {
        return this._refreshPromise?.promise;
    }

    triggerRefresh(_query?: PythonLocatorQuery, _options?: TriggerRefreshOptions): Promise<void> {
        const stopwatch = new StopWatch();
        traceLog('Native locator: Refresh started');
        if (this.refreshState === ProgressReportStage.discoveryStarted && this._refreshPromise?.promise) {
            return this._refreshPromise?.promise;
        }

        this.refreshState = ProgressReportStage.discoveryStarted;
        this._onProgress.fire({ stage: this.refreshState });
        this._refreshPromise = createDeferred();

        setImmediate(async () => {
            try {
                const before = this._envs.map((env) => env.executable.filename);
                const after: string[] = [];
                for await (const native of this.finder.refresh()) {
                    // --- Start Positron ---
                    // added await
                    const exe = await this.processNative(native);
                    // --- End Positron ---
                    if (exe) {
                        after.push(exe);
                    }
                }
                const envsToRemove = before.filter((item) => !after.includes(item));
                envsToRemove.forEach((item) => this.removeEnv(item));
                this._refreshPromise?.resolve();
            } catch (error) {
                this._refreshPromise?.reject(error);
            } finally {
                traceLog(`Native locator: Refresh finished in ${stopwatch.elapsedTime} ms`);
                this.refreshState = ProgressReportStage.discoveryFinished;
                this._refreshPromise = undefined;
                this._onProgress.fire({ stage: this.refreshState });
            }
        });

        return this._refreshPromise?.promise;
    }

    // --- Start Positron ---
    // added async/await
    private async processNative(native: NativeEnvInfo | NativeEnvManagerInfo): Promise<string | undefined> {
        if (isNativeEnvInfo(native)) {
            return await this.processEnv(native);
            // --- End Positron ---
        }
        this.processEnvManager(native);

        return undefined;
    }

    // --- Start Positron ---
    // added async
    private async processEnv(native: NativeEnvInfo): Promise<string | undefined> {
        // --- End Positron ---
        if (!validEnv(native)) {
            return undefined;
        }

        try {
            const version = native.version ? parseVersion(native.version) : undefined;

            if (categoryToKind(native.kind) === PythonEnvKind.Conda && !native.executable) {
                // This is a conda env without python, no point trying to resolve this.
                // There is nothing to resolve
                // --- Start Positron ---
                // added await
                return (await this.addEnv(native))?.executable.filename;
                // --- End Positron ---
            }
            if (native.executable && (!version || version.major < 0 || version.minor < 0 || version.micro < 0)) {
                // We have a path, but no version info, try to resolve the environment.
                // --- Start Positron ---
                // added async/await
                await this.finder
                    .resolve(native.executable)
                    .then(async (env) => {
                        if (env) {
                            await this.addEnv(env);
                            // --- End Positron ---
                        }
                    })
                    .ignoreErrors();
                return native.executable;
            }
            if (native.executable && version && version.major >= 0 && version.minor >= 0 && version.micro >= 0) {
                // --- Start Positron ---
                // added await
                return (await this.addEnv(native))?.executable.filename;
                // --- End Positron ---
            }
            traceError(`Failed to process environment: ${JSON.stringify(native)}`);
        } catch (err) {
            traceError(`Failed to process environment: ${err}`);
        }
        return undefined;
    }

    private condaPathAlreadySet: string | undefined;

    // eslint-disable-next-line class-methods-use-this
    private processEnvManager(native: NativeEnvManagerInfo) {
        const tool = native.tool.toLowerCase();
        switch (tool) {
            case 'conda':
                {
                    traceLog(`Conda environment manager found at: ${native.executable}`);
                    const settingPath = getCondaPathSetting();
                    if (!this.condaPathAlreadySet) {
                        if (settingPath === '' || settingPath === undefined) {
                            if (foundOnPath(native.executable)) {
                                setCondaBinary(native.executable);
                                this.condaPathAlreadySet = native.executable;
                                traceInfo(`Using conda: ${native.executable}`);
                            } else {
                                traceInfo(`Conda not found on PATH, skipping: ${native.executable}`);
                                traceInfo(
                                    'You can set the path to conda using the setting: `python.condaPath` if you want to use a different conda binary',
                                );
                            }
                        } else {
                            traceInfo(`Using conda from setting: ${settingPath}`);
                            this.condaPathAlreadySet = settingPath;
                        }
                    } else {
                        traceInfo(`Conda set to: ${this.condaPathAlreadySet}`);
                    }
                }
                break;
            case 'pyenv':
                traceLog(`Pyenv environment manager found at: ${native.executable}`);
                setPyEnvBinary(native.executable);
                break;
            case 'poetry':
                traceLog(`Poetry environment manager found at: ${native.executable}`);
                break;
            default:
                traceWarn(`Unknown environment manager: ${native.tool}`);
                break;
        }
    }

    getEnvs(_query?: PythonLocatorQuery): PythonEnvInfo[] {
        return this._envs;
    }

    // --- Start Positron ---
    // added async/await
    private async addEnv(native: NativeEnvInfo, searchLocation?: Uri): Promise<PythonEnvInfo | undefined> {
        const info = await toPythonEnvInfo(native, this._condaEnvDirs);
        if (info) {
            if (info.executable.filename && (await isUvEnvironment(info.executable.filename))) {
                traceInfo(`Found uv environment: ${info.executable.filename}`);
                info.kind = PythonEnvKind.Uv;
            }
            let old = this._envs.find((item) => item.executable.filename === info.executable.filename);
            if (!old) {
                // If the 'info' env is not already in the list, check if it is one of the additional env directories,
                // and if so, check if we have an equivalent env already and determine if we should add the 'info' env.
                const { reason, existingEnv } = await checkForExistingEnv(this._envs, info);
                switch (reason) {
                    case ExistingEnvAction.KeepExistingEnv:
                        // We found an 'old' equivalent env, but it has a shorter path than the equivalent new 'info' env.
                        // As such, keep the existing env and skip adding the new 'info' env.
                        traceVerbose(
                            `[addEnv] Not adding ${info.executable.filename} because it's equivalent to ${existingEnv.executable.filename}`,
                        );
                        return undefined;
                    case ExistingEnvAction.AddNewEnv:
                        // Proceed to add the 'info' env because we truly do not have an 'old' env.
                        break;
                    case ExistingEnvAction.ReplaceExistingEnv:
                        // 'info' is the shorter path env; set the 'old' env to the equivalent one we found
                        // so that we can replace it with 'info'.
                        traceVerbose(
                            `[addEnv] Replacing ${existingEnv.executable.filename} with ${info.executable.filename}`,
                        );
                        old = existingEnv;
                        break;
                    default:
                        // This shouldn't happen
                        traceError(
                            `[addEnv] Unknown action for existing env: ${reason} for ${info.executable.filename}`,
                        );
                        break;
                }
            }
            // --- End Positron ---
            if (old) {
                this._envs = this._envs.filter((item) => item.executable.filename !== info.executable.filename);
                this._envs.push(info);
                if (hasChanged(old, info)) {
                    this._onChanged.fire({ type: FileChangeType.Changed, old, new: info, searchLocation });
                }
            } else {
                this._envs.push(info);
                this._onChanged.fire({ type: FileChangeType.Created, new: info, searchLocation });
            }
        }

        return info;
    }

    private removeEnv(env: PythonEnvInfo | string): void {
        if (typeof env === 'string') {
            const old = this._envs.find((item) => item.executable.filename === env);
            this._envs = this._envs.filter((item) => item.executable.filename !== env);
            this._onChanged.fire({ type: FileChangeType.Deleted, old });
            return;
        }
        this._envs = this._envs.filter((item) => item.executable.filename !== env.executable.filename);
        this._onChanged.fire({ type: FileChangeType.Deleted, old: env });
    }

    @cache(30_000, true)
    async resolveEnv(envPath?: string): Promise<PythonEnvInfo | undefined> {
        if (envPath === undefined) {
            return undefined;
        }
        try {
            const native = await this.finder.resolve(envPath);
            if (native) {
                // --- Start Positron ---
                if (native.executable && (await isUvEnvironment(native.executable))) {
                    traceInfo(`Found uv environment: ${native.executable}`);
                    native.kind = NativePythonEnvironmentKind.Uv;
                }
                if (!native.kind && native.executable && (await isCustomEnvironment(native.executable))) {
                    native.kind = NativePythonEnvironmentKind.Custom;
                    native.source = [PythonEnvSource.UserSettings];
                }
                if (!native.kind && native.executable && isAdditionalGlobalBinPath(native.executable)) {
                    native.kind = NativePythonEnvironmentKind.GlobalPaths;
                }
                // --- End Positron ---
                if (native.kind === NativePythonEnvironmentKind.Conda && this._condaEnvDirs.length === 0) {
                    this._condaEnvDirs = (await getCondaEnvDirs()) ?? [];
                }
                // --- Start Positron ---
                // added await
                return await this.addEnv(native);
                // --- End Positron ---
            }
            return undefined;
        } catch {
            return undefined;
        }
    }

    private initializeWatcher(): void {
        const watcher = createPythonWatcher();
        this._disposables.push(
            watcher.onDidGlobalEnvChanged((e) => this.pathEventHandler(e)),
            watcher.onDidWorkspaceEnvChanged(async (e) => {
                await this.workspaceEventHandler(e);
            }),
            onDidChangeWorkspaceFolders((e: WorkspaceFoldersChangeEvent) => {
                e.removed.forEach((wf) => watcher.unwatchWorkspace(wf));
                e.added.forEach((wf) => watcher.watchWorkspace(wf));
            }),
            watcher,
        );

        getWorkspaceFolders()?.forEach((wf) => watcher.watchWorkspace(wf));
        const home = getUserHomeDir();
        if (home) {
            watcher.watchPath(Uri.file(path.join(home, '.conda', 'environments.txt')));
        }
    }

    private async pathEventHandler(e: PythonGlobalEnvEvent): Promise<void> {
        if (e.type === FileChangeType.Created || e.type === FileChangeType.Changed) {
            if (e.uri.fsPath.endsWith('environment.txt')) {
                const before = this._envs
                    .filter((env) => env.kind === PythonEnvKind.Conda)
                    .map((env) => env.executable.filename);
                for await (const native of this.finder.refresh(NativePythonEnvironmentKind.Conda)) {
                    // --- Start Positron ---
                    // added await
                    await this.processNative(native);
                    // --- End Positron ---
                }
                const after = this._envs
                    .filter((env) => env.kind === PythonEnvKind.Conda)
                    .map((env) => env.executable.filename);
                const envsToRemove = before.filter((item) => !after.includes(item));
                envsToRemove.forEach((item) => this.removeEnv(item));
            }
        }
    }

    private async workspaceEventHandler(e: PythonWorkspaceEnvEvent): Promise<void> {
        if (e.type === FileChangeType.Created || e.type === FileChangeType.Changed) {
            const native = await this.finder.resolve(e.executable);
            if (native) {
                // --- Start Positron ---
                // added await
                await this.addEnv(native, e.workspaceFolder.uri);
                // --- End Positron ---
            }
        } else {
            this.removeEnv(e.executable);
        }
    }
}

export function createNativeEnvironmentsApi(finder: NativePythonFinder): IDiscoveryAPI & Disposable {
    const native = new NativePythonEnvironments(finder);
    native.triggerRefresh().ignoreErrors();
    return native;
}

// --- Start Positron ---
/**
 * Checks for an equivalent environment if the new environment to be added is one of
 * the additional environment directories.
 *
 * The Native Python Finder may return multiple equivalent python executables when
 * searching in the additional env directories. For example, if the user has
 * `/opt/python/3.10.4/bin/python`, `/opt/python/3.10.4/bin/python3` and
 * `/opt/python/3.10.4/bin/python3.10` in their additional env directories, the
 * Native Python Finder will return all of these. However, these executables are
 * equivalent, and we only want to display one of them in the list of environments.
 *
 * In this example, `ls -al /opt/python/3.10.4/bin/python*` will show:
 * /opt/python/3.10.4/bin/python -> /opt/python/3.10.4/bin/python3
 * /opt/python/3.10.4/bin/python3 -> python3.10
 * /opt/python/3.10.4/bin/python3.10
 *
 * i.e., both `/opt/python/3.10.4/bin/python` and `/opt/python/3.10.4/bin/python3` are
 * symlinked to `/opt/python/3.10.4/bin/python3.10`, so they are all equivalent. In this
 * case, we only want to add one of them to the list of environments -- in particular,
 * the one with the shortest path: `/opt/python/3.10.4/bin/python`.
 *
 * @param envs The current list of environments
 * @param newEnv The new environment to be added
 * @return The result of the check -- how to proceed with the new environment and if found,
 *         the equivalent existing environment.
 */
async function checkForExistingEnv(envs: PythonEnvInfo[], newEnv: PythonEnvInfo): Promise<ExistingEnvResult> {
    const additionalEnvDirs = await getAdditionalEnvDirs();
    const isAdditionalEnv = additionalEnvDirs.find((dir) => isParentPath(newEnv.executable.filename, dir));

    // If the new env is not in an additional environment directory, then we don't
    // need to check for existing equivalent envs. Proceed to add the new env.
    if (!isAdditionalEnv) {
        return { reason: ExistingEnvAction.AddNewEnv, existingEnv: undefined };
    }

    // Look for an existing environment in the same additional environment directory
    // as the new env.
    const resolvedEnv = await resolveSymbolicLink(newEnv.executable.filename);
    let existingEnv: PythonEnvInfo | undefined;
    const resolvedItems = await Promise.all(envs.map((item) => resolveSymbolicLink(item.executable.filename)));
    for (let i = 0; i < envs.length; i++) {
        if (arePathsSame(resolvedEnv, resolvedItems[i])) {
            existingEnv = envs[i];
            break;
        }
    }
    if (!existingEnv) {
        return { reason: ExistingEnvAction.AddNewEnv, existingEnv: undefined };
    }

    // We have found an existing environment that is equivalent to the new environment,
    // so we now compare the two path lengths to see if we should add the new
    // environment or not.
    const shortestEnv = getShortestString([newEnv.executable.filename, existingEnv.executable.filename]);
    if (!shortestEnv) {
        // This shouldn't happen
        return { reason: ExistingEnvAction.AddNewEnv, existingEnv: undefined };
    }

    // If the new env being added doesn't have a shorter path than the existing env,
    // keep the existing env and don't add the new env.
    // Example:
    // - newEnv: `/opt/bin/python/3.10.4/bin/python3`
    // - existingEnv: `/opt/bin/python/3.10.4/bin/python`
    // Result: don't add the new env.
    if (newEnv.executable.filename !== shortestEnv) {
        return { reason: ExistingEnvAction.KeepExistingEnv, existingEnv };
    }

    // If the new environment to be added has the shorter path, replace the existing env.
    // Example:
    // - newEnv: `/opt/bin/python/3.10.4/bin/python`
    // - existingEnv: `/opt/bin/python/3.10.4/bin/python3.10`
    // Result: replace the existing env with the new env.
    return { reason: ExistingEnvAction.ReplaceExistingEnv, existingEnv };
}
// --- End Positron ---
