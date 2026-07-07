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
import { getShortVersionString, parseVersion } from './base/info/pythonVersion';
// --- Start Positron ---
// import { cache } from '../common/utils/decorators';
// --- End Positron ---
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
import { arePathsSame, canonicalizePath, isParentPath, normCasePath } from './common/externalDependencies';
import {
    ModuleEnvironmentLocator,
    moduleMetadataMap,
    pendingModuleRuntimeRegistrations,
    setModuleDiscoveryInFlight,
} from './base/locators/lowLevel/moduleEnvironmentLocator';
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
        case PythonEnvKind.Module:
            return 'Module';
        // --- End Positron ---
        case PythonEnvKind.System:
        case PythonEnvKind.Unknown:
        case PythonEnvKind.OtherGlobal:
        case PythonEnvKind.Custom:
        default:
            return undefined;
    }
}

// --- Start Positron ---
// @ts-ignore: Keeping original function for upstream compatibility
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function toShortVersionString(version: PythonVersion): string {
    return `${version.major}.${version.minor}.${version.micro}`.trim();
}
// --- End Positron ---

function getDisplayName(version: PythonVersion, kind: PythonEnvKind, arch: Architecture, name?: string): string {
    // --- Start Positron ---
    // use getShortVersionString instead of toShortVersionString
    // to get all version info (e.g. for pre-releases, alpha)
    const versionStr = getShortVersionString(version);
    // --- End Positron ---
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
            // --- Start Positron ---
            // add info if this is a pre-release version (e.g. alpha, beta, rc)
            ...(version.release && { release: version.release }),
            // --- End Positron ---
        },
        arch,
        distro: {
            org: '',
        },
        // --- Start Positron ---
        source: nativeEnv.source ?? [],
        // Carry PET's equivalent-path list through so getEnvIdentity() can
        // recognize launcher-style shims (e.g. uv's Windows trampolines) whose
        // realpath is not the interpreter they run. Omitted (not undefined) when
        // absent so deep-equality comparisons of envs are unaffected.
        ...(nativeEnv.symlinks && { symlinks: nativeEnv.symlinks }),
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

    // --- Start Positron ---
    // Cache of environment identities (canonical executable + canonical prefix),
    // keyed by executable filename. Maintained incrementally in
    // addEnv()/removeEnv() so checkForExistingEnv() can do O(1) lookups instead
    // of re-canonicalizing all existing envs on every new env addition (which was
    // O(N^2) total).
    private _envIdentities = new Map<string, string>();

    // Cache of resolved environments, keyed by the executable path passed to
    // resolveEnv(). Only successful resolutions are cached. Entries are
    // invalidated in addEnv()/removeEnv() so a late-arriving discovery
    // immediately supersedes any cached state.
    private _resolveEnvCache = new Map<string, { info: PythonEnvInfo; expiry: number }>();

    // In-flight promise deduplication for resolveEnv(). Concurrent callers for
    // the same envPath share a single PET round-trip. The entry is cleared on
    // settle so undefined results are never pinned (unlike the old @cache
    // decorator whose cachePromise=true mode cached the promise itself).
    private _resolveEnvInFlight = new Map<string, Promise<PythonEnvInfo | undefined>>();

    private static readonly _resolveEnvCacheMs = 30_000;
    // --- End Positron ---

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
                const { reason, existingEnv } = await checkForExistingEnv(this._envs, info, this._envIdentities);
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
            if (old) {
                // Remove the replaced env's identity cache entry. In the
                // ReplaceExistingEnv case, old's filename differs from info's,
                // so we also need to filter _envs by old's filename to
                // actually remove it (not just info's filename, which isn't
                // in _envs yet).
                const oldFilename = old.executable.filename;
                this._envIdentities.delete(oldFilename);
                // Drop any stale resolveEnv cache entry for the replaced path
                // so late callers don't see the superseded env.
                this._resolveEnvCache.delete(oldFilename);
                this._envs = this._envs.filter(
                    (item) =>
                        item.executable.filename !== info.executable.filename &&
                        item.executable.filename !== oldFilename,
                );
                // --- End Positron ---
                this._envs.push(info);
                if (hasChanged(old, info)) {
                    this._onChanged.fire({ type: FileChangeType.Changed, old, new: info, searchLocation });
                }
            } else {
                this._envs.push(info);
                this._onChanged.fire({ type: FileChangeType.Created, new: info, searchLocation });
            }
            // --- Start Positron ---
            // Publish the freshly resolved env to the resolveEnv cache so later
            // callers hit it without spawning another PET round-trip.
            this._resolveEnvCache.set(info.executable.filename, {
                info,
                expiry: Date.now() + NativePythonEnvironments._resolveEnvCacheMs,
            });
            // --- End Positron ---
        }

        return info;
    }

    private removeEnv(env: PythonEnvInfo | string): void {
        if (typeof env === 'string') {
            const old = this._envs.find((item) => item.executable.filename === env);
            this._envs = this._envs.filter((item) => item.executable.filename !== env);
            // --- Start Positron ---
            this._envIdentities.delete(env);
            this._resolveEnvCache.delete(env);
            // --- End Positron ---
            this._onChanged.fire({ type: FileChangeType.Deleted, old });
            return;
        }
        this._envs = this._envs.filter((item) => item.executable.filename !== env.executable.filename);
        // --- Start Positron ---
        this._envIdentities.delete(env.executable.filename);
        this._resolveEnvCache.delete(env.executable.filename);
        // --- End Positron ---
        this._onChanged.fire({ type: FileChangeType.Deleted, old: env });
    }

    // --- Start Positron ---
    // This decorator stored the pending promise immediately, so an undefined resolution
    // was pinned for 30s even after PET had since discovered the env. Use an explicit cache
    // that only caches successful resolutions and is invalidated on addEnv()/removeEnv().
    // The in-flight map deduplicates concurrent callers without caching undefined results.
    // @cache(30_000, true)
    // --- End Positron ---
    async resolveEnv(envPath?: string): Promise<PythonEnvInfo | undefined> {
        if (envPath === undefined) {
            return undefined;
        }
        // --- Start Positron ---
        const cached = this._resolveEnvCache.get(envPath);
        if (cached && cached.expiry > Date.now()) {
            return cached.info;
        }

        const inFlight = this._resolveEnvInFlight.get(envPath);
        if (inFlight) {
            return inFlight;
        }

        const promise = this._doResolveEnv(envPath);
        this._resolveEnvInFlight.set(envPath, promise);
        try {
            return await promise;
        } finally {
            this._resolveEnvInFlight.delete(envPath);
        }
        // --- End Positron ---
    }

    // --- Start Positron ---
    private async _doResolveEnv(envPath: string): Promise<PythonEnvInfo | undefined> {
        // --- End Positron ---
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
 * Wrapper that combines the native Python environments API with module environments.
 * Module environments are discovered using the ModuleEnvironmentLocator and merged
 * with the environments from the native API.
 */
class NativeWithModulesApi implements IDiscoveryAPI, Disposable {
    private readonly _onProgress: EventEmitter<ProgressNotificationEvent>;
    private readonly _onChanged: EventEmitter<PythonEnvCollectionChangedEvent>;
    private readonly _disposables: Disposable[] = [];
    private readonly _moduleLocator: ModuleEnvironmentLocator;
    private _moduleEnvs: PythonEnvInfo[] = [];
    private _refreshPromise?: Deferred<void>;

    constructor(private readonly nativeApi: NativePythonEnvironments) {
        this._onProgress = new EventEmitter<ProgressNotificationEvent>();
        this._onChanged = new EventEmitter<PythonEnvCollectionChangedEvent>();
        this._moduleLocator = new ModuleEnvironmentLocator();

        this._disposables.push(this._onProgress, this._onChanged);

        // Forward events from native API
        this._disposables.push(
            this.nativeApi.onProgress((e) => this._onProgress.fire(e)),
            this.nativeApi.onChanged((e) => this._onChanged.fire(e)),
        );
    }

    dispose(): void {
        this._disposables.forEach((d) => d.dispose());
        this.nativeApi.dispose();
    }

    get refreshState(): ProgressReportStage {
        return this.nativeApi.refreshState;
    }

    get onProgress(): Event<ProgressNotificationEvent> {
        return this._onProgress.event;
    }

    get onChanged(): Event<PythonEnvCollectionChangedEvent> {
        return this._onChanged.event;
    }

    getRefreshPromise(options?: GetRefreshEnvironmentsOptions): Promise<void> | undefined {
        return this._refreshPromise?.promise ?? this.nativeApi.getRefreshPromise(options);
    }

    async triggerRefresh(query?: PythonLocatorQuery, options?: TriggerRefreshOptions): Promise<void> {
        if (this._refreshPromise?.promise) {
            return this._refreshPromise.promise;
        }

        this._refreshPromise = createDeferred();

        try {
            // Trigger native discovery and module discovery in parallel, then
            // reconcile the two: a module-managed interpreter that the native
            // locator also finds must not be shown twice. Publish the combined
            // pass via setModuleDiscoveryInFlight so that runtime creation (which
            // reads the path-keyed module metadata map) waits for reconciliation
            // to finish; otherwise an interpreter could be registered before its
            // module metadata is keyed onto the native path and gets mislabeled.
            const nativeRefresh = this.nativeApi.triggerRefresh(query, options);
            const moduleDiscovery = this.discoverModuleEnvironments();
            const discoveryPass = (async () => {
                const [, rawModuleEnvs] = await Promise.all([nativeRefresh, moduleDiscovery]);
                return this.reconcileModuleEnvsWithNative(rawModuleEnvs);
            })();
            setModuleDiscoveryInFlight(discoveryPass);
            const moduleEnvs = await discoveryPass;

            // Update module environments and fire change events for new ones
            const oldModuleEnvPaths = new Set(this._moduleEnvs.map((e) => e.executable.filename));
            const newModuleEnvPaths = new Set(moduleEnvs.map((e) => e.executable.filename));

            // Fire events for removed module environments
            for (const oldEnv of this._moduleEnvs) {
                if (!newModuleEnvPaths.has(oldEnv.executable.filename)) {
                    this._onChanged.fire({ type: FileChangeType.Deleted, old: oldEnv });
                }
            }

            // Fire events for new module environments
            for (const newEnv of moduleEnvs) {
                if (!oldModuleEnvPaths.has(newEnv.executable.filename)) {
                    this._onChanged.fire({ type: FileChangeType.Created, new: newEnv });
                }
            }

            this._moduleEnvs = moduleEnvs;
            this._refreshPromise.resolve();
        } catch (error) {
            this._refreshPromise.reject(error);
        } finally {
            this._refreshPromise = undefined;
        }
    }

    getEnvs(query?: PythonLocatorQuery): PythonEnvInfo[] {
        const nativeEnvs = this.nativeApi.getEnvs(query);
        // Combine native envs with module envs. Module envs that resolve to the
        // same physical interpreter as a native env are already removed during
        // reconciliation (see reconcileModuleEnvsWithNative), with their module
        // metadata re-keyed onto the native path. The exact-filename filter below
        // is a cheap guard against any remaining same-path overlap.
        const nativeEnvPaths = new Set(nativeEnvs.map((e) => e.executable.filename));
        const uniqueModuleEnvs = this._moduleEnvs.filter((e) => !nativeEnvPaths.has(e.executable.filename));
        return [...nativeEnvs, ...uniqueModuleEnvs];
    }

    async resolveEnv(envPath: string): Promise<PythonEnvInfo | undefined> {
        // First check if it's a module environment
        const moduleEnv = this._moduleEnvs.find((e) => e.executable.filename === envPath);
        if (moduleEnv) {
            return moduleEnv;
        }
        // Fall back to native resolution
        return this.nativeApi.resolveEnv(envPath);
    }

    /**
     * Reconcile module-discovered environments against the native environments.
     *
     * The native locator and the module locator can surface the *same* physical
     * interpreter under different executable paths: the native locator collapses
     * symlinked siblings to the shortest path (e.g. `.../bin/python`), while the
     * module locator resolves `python3` first (e.g. `.../bin/python3`). A plain
     * filename comparison treats these as distinct, so the interpreter shows up
     * twice -- once labelled by its native env type (e.g. Unknown) and once as a
     * Module.
     *
     * For each module env that resolves (via symlink) to the same interpreter as
     * a native env, drop the separate module entry and re-key its module metadata
     * (and pending registration) onto the native interpreter's path. The single
     * remaining native entry is then labelled Module and launches with the module
     * environment loaded (see createPythonRuntimeMetadata). Module envs with no
     * native equivalent are kept as their own entries.
     *
     * @param moduleEnvs The freshly discovered module environments.
     * @returns The module environments that have no native equivalent.
     */
    private async reconcileModuleEnvsWithNative(moduleEnvs: PythonEnvInfo[]): Promise<PythonEnvInfo[]> {
        const { uniqueModuleEnvs, reKeys } = await partitionModuleEnvsByNative(
            moduleEnvs,
            this.nativeApi.getEnvs(),
            (p) => canonicalizePath(p),
        );

        // Apply the re-keys: move each duplicate's module metadata and pending
        // registration from the module path to the native path so the surviving
        // native entry is labelled Module and launches with the module loaded.
        for (const { from, to } of reKeys) {
            const metadata = moduleMetadataMap.get(from);
            if (metadata) {
                moduleMetadataMap.set(to, metadata);
                moduleMetadataMap.delete(from);
            }
            const pending = pendingModuleRuntimeRegistrations.get(from);
            if (pending) {
                pendingModuleRuntimeRegistrations.set(to, { ...pending, interpreterPath: to });
                pendingModuleRuntimeRegistrations.delete(from);
            }
            traceInfo(
                `[NativeWithModulesApi] Module interpreter ${from} matches native interpreter ${to}; attaching module metadata to the native entry to avoid a duplicate.`,
            );
        }
        return uniqueModuleEnvs;
    }

    /**
     * Discovers Python environments from environment modules.
     */
    private async discoverModuleEnvironments(): Promise<PythonEnvInfo[]> {
        const envs: PythonEnvInfo[] = [];

        // Module systems are only supported on Linux
        if (process.platform === 'win32' || process.platform === 'darwin') {
            return envs;
        }

        try {
            traceInfo('[NativeWithModulesApi] Discovering module environments');
            for await (const basicEnv of this._moduleLocator.iterEnvs()) {
                const envInfo = this.basicEnvToPythonEnvInfo(basicEnv);
                if (envInfo) {
                    envs.push(envInfo);
                }
            }
            traceInfo(`[NativeWithModulesApi] Found ${envs.length} module environments`);
        } catch (error) {
            traceError(`[NativeWithModulesApi] Error discovering module environments: ${error}`);
        }

        return envs;
    }

    /**
     * Converts a BasicEnvInfo from the module locator to a PythonEnvInfo.
     */
    private basicEnvToPythonEnvInfo(basicEnv: {
        kind: PythonEnvKind;
        executablePath: string;
        source?: PythonEnvSource[];
        envPath?: string;
    }): PythonEnvInfo | undefined {
        const metadata = moduleMetadataMap.get(basicEnv.executablePath);

        // Parse version from metadata (format: "3.11.3")
        const version = metadata?.version ? parseVersion(metadata.version) : { major: -1, minor: -1, micro: -1 };
        const versionStr = version.major >= 0 ? `${version.major}.${version.minor}.${version.micro}` : '';

        // Format display name as "Python X.Y.Z (Module: envName)"
        const moduleLabel = metadata ? `Module: ${metadata.environmentName}` : 'Module';
        const displayName = versionStr ? `Python ${versionStr} (${moduleLabel})` : `Python (${moduleLabel})`;

        return {
            name: metadata?.environmentName ?? '',
            location: basicEnv.executablePath,
            kind: basicEnv.kind,
            id: basicEnv.executablePath,
            executable: {
                filename: basicEnv.executablePath,
                sysPrefix: basicEnv.envPath ?? '',
                ctime: -1,
                mtime: -1,
            },
            version: {
                major: version.major,
                minor: version.minor,
                micro: version.micro,
                sysVersion: metadata?.version,
            },
            arch: Architecture.Unknown,
            distro: {
                org: '',
            },
            source: basicEnv.source ?? [],
            detailedDisplayName: displayName,
            display: displayName,
            type: undefined,
        };
    }
}

/**
 * Compute a stable identity for an environment, used to recognize when two
 * interpreter executables are really the same environment reached through
 * different paths.
 *
 * The identity combines the fully canonicalized executable path with the
 * canonicalized environment prefix:
 * - Canonicalizing (rather than following only leaf symlinks) collapses
 *   symlinked *directories*. uv, for example, installs a real
 *   `cpython-3.14.6-<platform>` directory alongside a `cpython-3.14-<platform>`
 *   symlink to it; an executable reached through the symlinked directory is not
 *   itself a symlink, so leaf-only resolution would leave the two paths looking
 *   distinct. Canonicalization makes such aliases of one interpreter match.
 * - Including the prefix keeps genuinely distinct environments apart. Two
 *   virtual environments whose `python` resolves to the same base interpreter
 *   have different prefixes, so they are not collapsed into one another (issue
 *   #14493); neither is a venv collapsed into its base interpreter.
 *
 * Module-discovered envs arrive without a `sysPrefix` (the environment-modules
 * API doesn't report one), so we fall back to the *resolved* executable's
 * install directory (the `<prefix>/bin/python` layout). Resolving first is what
 * matters: a module interpreter is often reached through a shim or symlink --
 * e.g. `~/.local/bin/python3` pointing into a uv install -- whose own
 * grandparent (`~/.local`) is not the interpreter's prefix. Deriving from the
 * resolved path instead lands on the real install dir, matching the prefix PET
 * reports for the native twin so the two collapse instead of showing twice.
 * Module discovery is Linux-only, where this layout holds.
 *
 * On Windows, uv installs `~/.local/bin/python*.exe` as *trampolines*: small
 * regular executables (not symlinks) that spawn the real interpreter, so
 * canonicalizing the executable is a no-op and the exe component alone would
 * leave the trampoline and its target looking distinct. PET spawns such
 * launchers and reports the interpreter's own `sys.executable` in `symlinks`,
 * so when the canonical executable falls outside the environment's canonical
 * prefix (the launcher signature -- a real interpreter or resolved symlink
 * always lives inside its prefix), we substitute the canonicalized `symlinks`
 * entry that lives inside the prefix. That collapses the trampoline into its
 * target while leaving in-prefix executables -- everything on mac/Linux --
 * on the exact same code path as before.
 *
 * The result is a comparison key only -- it is never used as a displayed path.
 *
 * @param env The environment to identify.
 * @param canonicalize Resolves a path to its canonical real path. Injected so
 *        callers/tests can supply a real or fake resolver.
 */
async function getEnvIdentity(
    env: PythonEnvInfo,
    canonicalize: (p: string) => Promise<string> = canonicalizePath,
): Promise<string> {
    const { filename, sysPrefix } = env.executable;
    let canonicalExe = await canonicalize(filename);
    const prefix = sysPrefix || path.dirname(path.dirname(canonicalExe));
    const canonicalPrefix = await canonicalize(prefix);
    if (!isParentPath(canonicalExe, canonicalPrefix)) {
        // Launcher-style shim (see the trampoline note above): identify it by
        // the real, in-prefix interpreter PET reports instead.
        for (const link of env.symlinks ?? []) {
            const canonicalLink = await canonicalize(link);
            if (!arePathsSame(canonicalLink, canonicalExe) && isParentPath(canonicalLink, canonicalPrefix)) {
                canonicalExe = canonicalLink;
                break;
            }
        }
    }
    // NUL can't appear in a path, so it's a safe separator between the two
    // components. normCasePath makes the comparison case-insensitive where the
    // platform's filesystem is (Windows, macOS).
    return `${normCasePath(canonicalExe)}\0${normCasePath(canonicalPrefix)}`;
}

/**
 * Partition module-discovered environments into those that duplicate a native
 * environment and those that are standalone.
 *
 * The native locator and the module locator can surface the *same* physical
 * interpreter under different executable paths: the native locator collapses
 * symlinked siblings to the shortest path (e.g. `.../bin/python`), while the
 * module locator resolves `python3` first (e.g. `.../bin/python3`). Comparing
 * raw filenames treats these as distinct, so the interpreter shows up twice.
 * Comparing environment identities (see {@link getEnvIdentity}) reveals that they
 * are the same environment, while keeping genuinely distinct environments apart.
 *
 * @param moduleEnvs The freshly discovered module environments.
 * @param nativeEnvs The environments found by the native locator.
 * @param canonicalize Resolves a path to its canonical real path. Injected so
 *        callers/tests can supply a real or fake resolver.
 * @returns `uniqueModuleEnvs` (module envs with no native equivalent, kept as
 *          their own entries) and `reKeys` (module-path -> native-path moves the
 *          caller should apply to the module metadata maps so the surviving
 *          native entry is labelled Module). A module env whose path is identical
 *          to its native equivalent is neither kept nor re-keyed: the native
 *          entry already represents it and its metadata is already keyed there.
 */
export async function partitionModuleEnvsByNative(
    moduleEnvs: PythonEnvInfo[],
    nativeEnvs: PythonEnvInfo[],
    canonicalize: (executablePath: string) => Promise<string>,
): Promise<{ uniqueModuleEnvs: PythonEnvInfo[]; reKeys: { from: string; to: string }[] }> {
    const reKeys: { from: string; to: string }[] = [];
    if (moduleEnvs.length === 0 || nativeEnvs.length === 0) {
        return { uniqueModuleEnvs: moduleEnvs, reKeys };
    }

    // Map each native interpreter's environment identity to the path Positron
    // registers it under. Native discovery already collapses equivalents to the
    // shortest path, so the first match per identity wins.
    const nativePathByIdentity = new Map<string, string>();
    await Promise.all(
        nativeEnvs.map(async (e) => {
            const identity = await getEnvIdentity(e, canonicalize);
            if (!nativePathByIdentity.has(identity)) {
                nativePathByIdentity.set(identity, e.executable.filename);
            }
        }),
    );

    const uniqueModuleEnvs: PythonEnvInfo[] = [];
    for (const moduleEnv of moduleEnvs) {
        const modulePath = moduleEnv.executable.filename;
        const identity = await getEnvIdentity(moduleEnv, canonicalize);
        const nativePath = nativePathByIdentity.get(identity);
        if (!nativePath) {
            // No native equivalent: keep the module env as its own entry.
            uniqueModuleEnvs.push(moduleEnv);
        } else if (!arePathsSame(nativePath, modulePath)) {
            reKeys.push({ from: modulePath, to: nativePath });
        }
        // else: same path; the native entry already represents this interpreter
        // and its metadata is already keyed there, so drop the module duplicate.
    }
    return { uniqueModuleEnvs, reKeys };
}

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
 * Equivalence is decided by environment identity (see {@link getEnvIdentity}), not by
 * the symlink target alone: two interpreters are equivalent only when they canonicalize
 * to the same executable *and* share an environment prefix. This collapses aliases of a
 * single interpreter -- including ones reached through a symlinked directory (issue
 * #14489) -- without merging distinct virtual environments that happen to share a base
 * interpreter (issue #14493).
 *
 * @param envs The current list of environments
 * @param newEnv The new environment to be added
 * @param envIdentities Cache of environment identities keyed by executable filename.
 * @return The result of the check -- how to proceed with the new environment and if found,
 *         the equivalent existing environment.
 */
async function checkForExistingEnv(
    envs: PythonEnvInfo[],
    newEnv: PythonEnvInfo,
    envIdentities: Map<string, string>,
): Promise<ExistingEnvResult> {
    const additionalEnvDirs = await getAdditionalEnvDirs();
    const isAdditionalEnv = additionalEnvDirs.find((dir) => isParentPath(newEnv.executable.filename, dir));

    // If the new env is not in an additional environment directory, then we don't
    // need to check for existing equivalent envs. Proceed to add the new env.
    if (!isAdditionalEnv) {
        return { reason: ExistingEnvAction.AddNewEnv, existingEnv: undefined };
    }

    // Look for an existing environment with the same identity as the new env. Use
    // the cached identities to avoid an O(N) pass of canonicalizePath() calls on
    // every invocation.
    const newIdentity = await getEnvIdentity(newEnv);
    let existingEnv: PythonEnvInfo | undefined;
    for (const item of envs) {
        let itemIdentity = envIdentities.get(item.executable.filename);
        if (itemIdentity === undefined) {
            itemIdentity = await getEnvIdentity(item);
            envIdentities.set(item.executable.filename, itemIdentity);
        }
        if (newIdentity === itemIdentity) {
            existingEnv = item;
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

/**
 * Creates a native environments API that also includes module environments.
 * This wraps the native API and adds environments discovered from the ModuleEnvironmentLocator.
 */
export function createNativeEnvironmentsApiWithModules(finder: NativePythonFinder): IDiscoveryAPI & Disposable {
    const native = new NativePythonEnvironments(finder);
    const wrapper = new NativeWithModulesApi(native);
    wrapper.triggerRefresh().ignoreErrors();
    return wrapper;
}

// --- End Positron ---
