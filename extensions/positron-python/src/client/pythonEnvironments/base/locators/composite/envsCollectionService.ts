// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as fsPath from 'path';
import { Event, EventEmitter, Uri, workspace } from 'vscode';
import '../../../../common/extensions';
import { createDeferred, Deferred, flattenIterable } from '../../../../common/utils/async';
import { StopWatch } from '../../../../common/utils/stopWatch';
import { traceError, traceInfo, traceVerbose } from '../../../../logging';
import { sendTelemetryEvent } from '../../../../telemetry';
import { EventName } from '../../../../telemetry/constants';
// --- Start Positron ---
// Import untildify.
import { normalizePath, readFile } from '../../../common/externalDependencies';
import { untildify } from '../../../../common/helpers';
// --- End Positron ---
import { PythonEnvInfo, PythonEnvKind } from '../../info';
import { getEnvPath } from '../../info/env';
import {
    GetRefreshEnvironmentsOptions,
    IDiscoveryAPI,
    IResolvingLocator,
    isProgressEvent,
    ProgressNotificationEvent,
    ProgressReportStage,
    PythonLocatorQuery,
    TriggerRefreshOptions,
} from '../../locator';
import { getQueryFilter } from '../../locatorUtils';
import { PythonEnvCollectionChangedEvent, PythonEnvsWatcher } from '../../watcher';
import { IEnvsCollectionCache } from './envsCollectionCache';
import {
    getNativePythonFinder,
    isNativeEnvInfo,
    NativeEnvInfo,
    NativePythonFinder,
} from '../common/nativePythonFinder';
import { pathExists } from '../../../../common/platform/fs-paths';
import { noop } from '../../../../common/utils/misc';
import { parseVersion } from '../../info/pythonVersion';
import { Conda, CONDAPATH_SETTING_KEY, isCondaEnvironment } from '../../../common/environmentManagers/conda';
import { getConfiguration } from '../../../../common/vscodeApis/workspaceApis';
import { getUserHomeDir } from '../../../../common/utils/platform';
import { categoryToKind } from '../common/nativePythonUtils';
import type { IExtensionContext } from '../../../../common/types';

/**
 * A service which maintains the collection of known environments.
 */
export class EnvsCollectionService extends PythonEnvsWatcher<PythonEnvCollectionChangedEvent> implements IDiscoveryAPI {
    /** Keeps track of ongoing refreshes for various queries. */
    private refreshesPerQuery = new Map<PythonLocatorQuery | undefined, Deferred<void>>();

    /** Keeps track of scheduled refreshes other than the ongoing one for various queries. */
    private scheduledRefreshesPerQuery = new Map<PythonLocatorQuery | undefined, Promise<void>>();

    /** Keeps track of promises which resolves when a stage has been reached */
    private progressPromises = new Map<ProgressReportStage, Deferred<void>>();

    /** Keeps track of whether a refresh has been triggered for various queries. */
    private hasRefreshFinishedForQuery = new Map<PythonLocatorQuery | undefined, boolean>();

    private readonly progress = new EventEmitter<ProgressNotificationEvent>();

    private readonly nativeFinder: NativePythonFinder;

    public refreshState = ProgressReportStage.discoveryFinished;

    public get onProgress(): Event<ProgressNotificationEvent> {
        return this.progress.event;
    }

    public getRefreshPromise(options?: GetRefreshEnvironmentsOptions): Promise<void> | undefined {
        const stage = options?.stage ?? ProgressReportStage.discoveryFinished;
        return this.progressPromises.get(stage)?.promise;
    }

    constructor(
        private readonly cache: IEnvsCollectionCache,
        private readonly locator: IResolvingLocator,
        context?: IExtensionContext,
    ) {
        super();
        this.nativeFinder = getNativePythonFinder(context);
        this.locator.onChanged((event) => {
            const query: PythonLocatorQuery | undefined = event.providerId
                ? { providerId: event.providerId, envPath: event.envPath }
                : undefined; // We can also form a query based on the event, but skip that for simplicity.
            let scheduledRefresh = this.scheduledRefreshesPerQuery.get(query);
            // If there is no refresh scheduled for the query, start a new one.
            if (!scheduledRefresh) {
                scheduledRefresh = this.scheduleNewRefresh(query);
            }
            scheduledRefresh.then(() => {
                // Once refresh of cache is complete, notify changes.
                this.fire(event);
            });
        });
        this.cache.onChanged((e) => {
            this.fire(e);
        });
        this.onProgress((event) => {
            this.refreshState = event.stage;
            // Resolve progress promise indicating the stage has been reached.
            this.progressPromises.get(event.stage)?.resolve();
            this.progressPromises.delete(event.stage);
        });
    }

    public async resolveEnv(path: string): Promise<PythonEnvInfo | undefined> {
        // --- Start Positron ---
        // Positron uses tildes to represent the home dir, remove it.
        path = untildify(path);
        // --- End Positron ---
        path = normalizePath(path);
        // Note cache may have incomplete info when a refresh is happening.
        // This API is supposed to return complete info by definition, so
        // only use cache if it has complete info on an environment.
        const cachedEnv = await this.cache.getLatestInfo(path);
        if (cachedEnv) {
            return cachedEnv;
        }
        const resolved = await this.locator.resolveEnv(path).catch((ex) => {
            traceError(`Failed to resolve ${path}`, ex);
            return undefined;
        });
        traceVerbose(`Resolved ${path} using downstream locator`);
        if (resolved) {
            this.cache.addEnv(resolved, true);
        }
        return resolved;
    }

    public getEnvs(query?: PythonLocatorQuery): PythonEnvInfo[] {
        const cachedEnvs = this.cache.getAllEnvs();
        return query ? cachedEnvs.filter(getQueryFilter(query)) : cachedEnvs;
    }

    public triggerRefresh(query?: PythonLocatorQuery, options?: TriggerRefreshOptions): Promise<void> {
        let refreshPromise = this.getRefreshPromiseForQuery(query);
        if (!refreshPromise) {
            if (options?.ifNotTriggerredAlready && this.hasRefreshFinished(query)) {
                // Do not trigger another refresh if a refresh has previously finished.
                return Promise.resolve();
            }
            const stopWatch = new StopWatch();
            traceInfo(`Starting Environment refresh`);
            refreshPromise = this.startRefresh(query).then(() => {
                this.sendTelemetry(query, stopWatch);
                traceInfo(`Environment refresh took ${stopWatch.elapsedTime} milliseconds`);
            });
        }
        return refreshPromise;
    }

    private startRefresh(query: PythonLocatorQuery | undefined): Promise<void> {
        this.createProgressStates(query);
        const promise = this.addEnvsToCacheForQuery(query);
        return promise
            .then(async () => {
                this.resolveProgressStates(query);
            })
            .catch((ex) => {
                this.rejectProgressStates(query, ex);
            });
    }

    private async addEnvsToCacheForQuery(query: PythonLocatorQuery | undefined) {
        const iterator = this.locator.iterEnvs(query);
        const seen: PythonEnvInfo[] = [];
        const state = {
            done: false,
            pending: 0,
        };
        const updatesDone = createDeferred<void>();
        const stopWatch = new StopWatch();
        if (iterator.onUpdated !== undefined) {
            const listener = iterator.onUpdated(async (event) => {
                if (isProgressEvent(event)) {
                    switch (event.stage) {
                        case ProgressReportStage.discoveryFinished:
                            state.done = true;
                            listener.dispose();
                            traceInfo(`Environments refresh finished (event): ${stopWatch.elapsedTime} milliseconds`);
                            break;
                        case ProgressReportStage.allPathsDiscovered:
                            if (!query) {
                                traceInfo(
                                    `Environments refresh paths discovered (event): ${stopWatch.elapsedTime} milliseconds`,
                                );
                                // Only mark as all paths discovered when querying for all envs.
                                this.progress.fire(event);
                            }
                            break;
                        default:
                            this.progress.fire(event);
                    }
                } else if (event.index !== undefined) {
                    state.pending += 1;
                    this.cache.updateEnv(seen[event.index], event.update);
                    if (event.update) {
                        seen[event.index] = event.update;
                    }
                    state.pending -= 1;
                }
                if (state.done && state.pending === 0) {
                    updatesDone.resolve();
                }
            });
        } else {
            this.progress.fire({ stage: ProgressReportStage.discoveryStarted });
            updatesDone.resolve();
        }

        for await (const env of iterator) {
            seen.push(env);
            this.cache.addEnv(env);
        }
        traceInfo(`Environments refresh paths discovered: ${stopWatch.elapsedTime} milliseconds`);
        await updatesDone.promise;
        // If query for all envs is done, `seen` should contain the list of all envs.
        await this.cache.validateCache(seen, query === undefined);
        this.cache.flush().ignoreErrors();
    }

    /**
     * See if we already have a refresh promise for the query going on and return it.
     */
    private getRefreshPromiseForQuery(query?: PythonLocatorQuery) {
        // Even if no refresh is running for this exact query, there might be other
        // refreshes running for a superset of this query. For eg. the `undefined` query
        // is a superset for every other query, only consider that for simplicity.
        return this.refreshesPerQuery.get(query)?.promise ?? this.refreshesPerQuery.get(undefined)?.promise;
    }

    private hasRefreshFinished(query?: PythonLocatorQuery) {
        return this.hasRefreshFinishedForQuery.get(query) ?? this.hasRefreshFinishedForQuery.get(undefined);
    }

    /**
     * Ensure we trigger a fresh refresh for the query after the current refresh (if any) is done.
     */
    private async scheduleNewRefresh(query?: PythonLocatorQuery): Promise<void> {
        const refreshPromise = this.getRefreshPromiseForQuery(query);
        let nextRefreshPromise: Promise<void>;
        if (!refreshPromise) {
            nextRefreshPromise = this.startRefresh(query);
        } else {
            nextRefreshPromise = refreshPromise.then(() => {
                // No more scheduled refreshes for this query as we're about to start the scheduled one.
                this.scheduledRefreshesPerQuery.delete(query);
                this.startRefresh(query);
            });
            this.scheduledRefreshesPerQuery.set(query, nextRefreshPromise);
        }
        return nextRefreshPromise;
    }

    private createProgressStates(query: PythonLocatorQuery | undefined) {
        this.refreshesPerQuery.set(query, createDeferred<void>());
        Object.values(ProgressReportStage).forEach((stage) => {
            this.progressPromises.set(stage, createDeferred<void>());
        });
        if (ProgressReportStage.allPathsDiscovered && query) {
            // Only mark as all paths discovered when querying for all envs.
            this.progressPromises.delete(ProgressReportStage.allPathsDiscovered);
        }
    }

    private rejectProgressStates(query: PythonLocatorQuery | undefined, ex: Error) {
        this.refreshesPerQuery.get(query)?.reject(ex);
        this.refreshesPerQuery.delete(query);
        Object.values(ProgressReportStage).forEach((stage) => {
            this.progressPromises.get(stage)?.reject(ex);
            this.progressPromises.delete(stage);
        });
    }

    private resolveProgressStates(query: PythonLocatorQuery | undefined) {
        this.refreshesPerQuery.get(query)?.resolve();
        this.refreshesPerQuery.delete(query);
        // Refreshes per stage are resolved using progress events instead.
        const isRefreshComplete = Array.from(this.refreshesPerQuery.values()).every((d) => d.completed);
        if (isRefreshComplete) {
            this.progress.fire({ stage: ProgressReportStage.discoveryFinished });
        }
    }

    private telemetrySentOnce = false;

    private async sendTelemetry(query: PythonLocatorQuery | undefined, stopWatch: StopWatch) {
        if (!query && !this.hasRefreshFinished(query)) {
            void this.sendTelemetryImpl(stopWatch);
        }
        this.hasRefreshFinishedForQuery.set(query, true);
    }

    private async sendTelemetryImpl(stopWatch: StopWatch) {
        if (this.telemetrySentOnce) {
            return;
        }
        this.telemetrySentOnce = true;
        const { elapsedTime } = stopWatch;
        const workspaceFolders = workspace.workspaceFolders || [];
        const query: PythonLocatorQuery = {
            searchLocations: {
                roots: workspaceFolders.map((w) => w.uri),
            },
        };

        const envs = this.getEnvs(workspaceFolders.length ? query : undefined);

        const nativeEnvs: NativeEnvInfo[] = [];
        const executablesFoundByNativeLocator = new Set<string>();
        const nativeStopWatch = new StopWatch();
        for await (const data of this.nativeFinder.refresh()) {
            if (isNativeEnvInfo(data)) {
                nativeEnvs.push(data);
                if (data.executable) {
                    // Lowercase for purposes of comparison (safe).
                    executablesFoundByNativeLocator.add(data.executable.toLowerCase());
                } else if (data.prefix) {
                    // Lowercase for purposes of comparison (safe).
                    executablesFoundByNativeLocator.add(data.prefix.toLowerCase());
                }
                // Lowercase for purposes of comparison (safe).
                (data.symlinks || []).forEach((exe) => executablesFoundByNativeLocator.add(exe.toLowerCase()));
            }
        }
        const nativeDuration = nativeStopWatch.elapsedTime;
        void this.sendNativeLocatorTelemetry(nativeEnvs);
        const missingEnvironments = {
            envsWithDuplicatePrefixes: 0,
            envsNotFound: 0,
            missingNativeCondaEnvs: 0,
            missingNativeCustomEnvs: 0,
            missingNativeMicrosoftStoreEnvs: 0,
            missingNativeGlobalEnvs: 0,
            missingNativeOtherVirtualEnvs: 0,
            missingNativePipEnvEnvs: 0,
            missingNativePoetryEnvs: 0,
            missingNativePyenvEnvs: 0,
            missingNativeSystemEnvs: 0,
            missingNativeUnknownEnvs: 0,
            missingNativeVenvEnvs: 0,
            missingNativeVirtualEnvEnvs: 0,
            missingNativeVirtualEnvWrapperEnvs: 0,
            missingNativeOtherGlobalEnvs: 0,
        };

        const nativeCondaEnvs = nativeEnvs.filter((e) => categoryToKind(e.kind) === PythonEnvKind.Conda);
        const condaTelemetry = await getCondaTelemetry(this.nativeFinder, nativeCondaEnvs, nativeEnvs);
        const prefixesSeenAlready = new Set<string>();
        await Promise.all(
            envs.map(async (env) => {
                try {
                    // Verify the file exists, sometimes the files do not eixst,
                    // E.g. we we can have a conda env without Python, in such a case we'll have a prefix but no executable.
                    // However in the extension we treat this as an environment with an executable that can be `python` or `<fully resolved path to what we think will be the Python exe>`.
                    // However native locator will not return exes. Even though the env is detected.
                    // For those cases we'll look at the sysprefix.
                    let exe = env.executable.filename || '';
                    if (!exe || !(await pathExists(exe))) {
                        exe = (await pathExists(env.executable.sysPrefix)) ? env.executable.sysPrefix : '';
                    }
                    if (env.executable.sysPrefix && prefixesSeenAlready.has(env.executable.sysPrefix)) {
                        missingEnvironments.envsWithDuplicatePrefixes += 1;
                    }
                    prefixesSeenAlready.add(env.executable.sysPrefix);
                    // Lowercase for purposes of comparison (safe).
                    exe = exe.trim().toLowerCase();
                    if (!exe) {
                        if (env.executable.filename || env.executable.sysPrefix) {
                            missingEnvironments.envsNotFound += 1;
                        }
                        return;
                    }
                    // If this exe is not found by the native locator, then it is missing.
                    // We need to also look in the list of symlinks.
                    // Taking a count of each group isn't necessarily accurate.
                    // Native locator might identify something as System and
                    // Old Python ext code might identify it as Global, or the like.
                    // Safest is to look for the executable.
                    if (!executablesFoundByNativeLocator.has(exe)) {
                        // There's a known bug with stable locator
                        // https://github.com/microsoft/vscode-python/issues/23659
                        // PyEnv Virtual envs are detected from the wrong location, as a result the exe will be different
                        // from the one found by native locator.
                        if (
                            env.kind === PythonEnvKind.Pyenv &&
                            (exe.toLowerCase().includes('/envs/') || exe.toLowerCase().includes('\\envs\\'))
                        ) {
                            return;
                        }
                        traceError(`Environment ${exe} is missing from native locator`);
                        switch (env.kind) {
                            case PythonEnvKind.Conda:
                                missingEnvironments.missingNativeCondaEnvs += 1;
                                break;
                            case PythonEnvKind.Custom:
                                missingEnvironments.missingNativeCustomEnvs += 1;
                                break;
                            case PythonEnvKind.MicrosoftStore:
                                missingEnvironments.missingNativeMicrosoftStoreEnvs += 1;
                                break;
                            case PythonEnvKind.OtherGlobal:
                                missingEnvironments.missingNativeGlobalEnvs += 1;
                                break;
                            case PythonEnvKind.OtherVirtual:
                                missingEnvironments.missingNativeOtherVirtualEnvs += 1;
                                break;
                            case PythonEnvKind.Pipenv:
                                missingEnvironments.missingNativePipEnvEnvs += 1;
                                break;
                            case PythonEnvKind.Poetry:
                                missingEnvironments.missingNativePoetryEnvs += 1;
                                break;
                            case PythonEnvKind.Pyenv:
                                missingEnvironments.missingNativePyenvEnvs += 1;
                                break;
                            case PythonEnvKind.System:
                                missingEnvironments.missingNativeSystemEnvs += 1;
                                break;
                            case PythonEnvKind.Unknown:
                                missingEnvironments.missingNativeUnknownEnvs += 1;
                                break;
                            case PythonEnvKind.Venv:
                                missingEnvironments.missingNativeVenvEnvs += 1;
                                break;
                            case PythonEnvKind.VirtualEnv:
                                missingEnvironments.missingNativeVirtualEnvEnvs += 1;
                                break;
                            case PythonEnvKind.VirtualEnvWrapper:
                                missingEnvironments.missingNativeVirtualEnvWrapperEnvs += 1;
                                break;
                            case PythonEnvKind.ActiveState:
                            case PythonEnvKind.Hatch:
                            case PythonEnvKind.Pixi:
                                // Do nothing.
                                break;
                            default:
                                break;
                        }
                    }
                } catch (ex) {
                    traceError(
                        `Failed to send telemetry for missing environment ${
                            env.executable.filename || env.executable.sysPrefix
                        }`,
                        ex,
                    );
                }
            }),
        ).catch((ex) => traceError('Failed to send telemetry for missing environments', ex));

        const environmentsWithoutPython = envs.filter(
            (e) => getEnvPath(e.executable.filename, e.location).pathType === 'envFolderPath',
        ).length;
        const activeStateEnvs = envs.filter((e) => e.kind === PythonEnvKind.ActiveState).length;
        const condaEnvs = envs.filter((e) => e.kind === PythonEnvKind.Conda);
        const customEnvs = envs.filter((e) => e.kind === PythonEnvKind.Custom).length;
        const hatchEnvs = envs.filter((e) => e.kind === PythonEnvKind.Hatch).length;
        const microsoftStoreEnvs = envs.filter((e) => e.kind === PythonEnvKind.MicrosoftStore).length;
        const otherGlobalEnvs = envs.filter((e) => e.kind === PythonEnvKind.OtherGlobal).length;
        const otherVirtualEnvs = envs.filter((e) => e.kind === PythonEnvKind.OtherVirtual).length;
        const pipEnvEnvs = envs.filter((e) => e.kind === PythonEnvKind.Pipenv).length;
        const poetryEnvs = envs.filter((e) => e.kind === PythonEnvKind.Poetry).length;
        const pyenvEnvs = envs.filter((e) => e.kind === PythonEnvKind.Pyenv).length;
        const systemEnvs = envs.filter((e) => e.kind === PythonEnvKind.System).length;
        const unknownEnvs = envs.filter((e) => e.kind === PythonEnvKind.Unknown).length;
        const venvEnvs = envs.filter((e) => e.kind === PythonEnvKind.Venv).length;
        const virtualEnvEnvs = envs.filter((e) => e.kind === PythonEnvKind.VirtualEnv).length;
        const virtualEnvWrapperEnvs = envs.filter((e) => e.kind === PythonEnvKind.VirtualEnvWrapper).length;
        const global = envs.filter(
            (e) =>
                e.kind === PythonEnvKind.OtherGlobal ||
                e.kind === PythonEnvKind.System ||
                e.kind === PythonEnvKind.Custom ||
                e.kind === PythonEnvKind.OtherVirtual,
        ).length;

        condaTelemetry.condaEnvsWithoutPrefix = condaEnvs.filter((e) => !e.executable.sysPrefix).length;

        await Promise.all(
            condaEnvs.map(async (e) => {
                if (e.executable.sysPrefix && !(await pathExists(e.executable.sysPrefix))) {
                    condaTelemetry.prefixNotExistsCondaEnvs += 1;
                }
                if (e.executable.filename && !(await isCondaEnvironment(e.executable.filename))) {
                    condaTelemetry.invalidCondaEnvs += 1;
                }
            }),
        );

        const nativeEnvironmentsWithoutPython = nativeEnvs.filter((e) => e.executable === undefined).length;
        const nativeCustomEnvs = nativeEnvs.filter((e) => categoryToKind(e.kind) === PythonEnvKind.Custom).length;
        const nativeMicrosoftStoreEnvs = nativeEnvs.filter(
            (e) => categoryToKind(e.kind) === PythonEnvKind.MicrosoftStore,
        ).length;
        const nativeOtherGlobalEnvs = nativeEnvs.filter((e) => categoryToKind(e.kind) === PythonEnvKind.OtherGlobal)
            .length;
        const nativeOtherVirtualEnvs = nativeEnvs.filter((e) => categoryToKind(e.kind) === PythonEnvKind.OtherVirtual)
            .length;
        const nativePipEnvEnvs = nativeEnvs.filter((e) => categoryToKind(e.kind) === PythonEnvKind.Pipenv).length;
        const nativePoetryEnvs = nativeEnvs.filter((e) => categoryToKind(e.kind) === PythonEnvKind.Poetry).length;
        const nativePyenvEnvs = nativeEnvs.filter((e) => categoryToKind(e.kind) === PythonEnvKind.Pyenv).length;
        const nativeSystemEnvs = nativeEnvs.filter((e) => categoryToKind(e.kind) === PythonEnvKind.System).length;
        const nativeUnknownEnvs = nativeEnvs.filter((e) => categoryToKind(e.kind) === PythonEnvKind.Unknown).length;
        const nativeVenvEnvs = nativeEnvs.filter((e) => categoryToKind(e.kind) === PythonEnvKind.Venv).length;
        const nativeVirtualEnvEnvs = nativeEnvs.filter((e) => categoryToKind(e.kind) === PythonEnvKind.VirtualEnv)
            .length;
        const nativeVirtualEnvWrapperEnvs = nativeEnvs.filter(
            (e) => categoryToKind(e.kind) === PythonEnvKind.VirtualEnvWrapper,
        ).length;
        const nativeGlobal = nativeEnvs.filter(
            (e) =>
                categoryToKind(e.kind) === PythonEnvKind.OtherGlobal ||
                categoryToKind(e.kind) === PythonEnvKind.System ||
                categoryToKind(e.kind) === PythonEnvKind.Custom ||
                categoryToKind(e.kind) === PythonEnvKind.OtherVirtual,
        ).length;

        // Intent is to capture time taken for discovery of all envs to complete the first time.
        sendTelemetryEvent(EventName.PYTHON_INTERPRETER_DISCOVERY, elapsedTime, {
            telVer: 7,
            nativeDuration,
            workspaceFolderCount: (workspace.workspaceFolders || []).length,
            interpreters: this.cache.getAllEnvs().length,
            environmentsWithoutPython,
            activeStateEnvs,
            condaEnvs: condaEnvs.length,
            customEnvs,
            hatchEnvs,
            microsoftStoreEnvs,
            otherGlobalEnvs,
            otherVirtualEnvs,
            pipEnvEnvs,
            poetryEnvs,
            pyenvEnvs,
            systemEnvs,
            unknownEnvs,
            venvEnvs,
            virtualEnvEnvs,
            virtualEnvWrapperEnvs,
            global,
            nativeEnvironmentsWithoutPython,
            nativeCondaEnvs: nativeCondaEnvs.length,
            nativeCustomEnvs,
            nativeMicrosoftStoreEnvs,
            nativeOtherGlobalEnvs,
            nativeOtherVirtualEnvs,
            nativePipEnvEnvs,
            nativePoetryEnvs,
            nativePyenvEnvs,
            nativeSystemEnvs,
            nativeUnknownEnvs,
            nativeVenvEnvs,
            nativeVirtualEnvEnvs,
            nativeVirtualEnvWrapperEnvs,
            nativeGlobal,
            ...condaTelemetry,
            ...missingEnvironments,
        });
    }

    private telemetrySentOnceForNativeLocator = false;

    private async sendNativeLocatorTelemetry(nativeEnvs: NativeEnvInfo[]) {
        if (this.telemetrySentOnceForNativeLocator) {
            return;
        }
        this.telemetrySentOnceForNativeLocator = true;
        const invalidVersions = {
            invalidVersionsCondaEnvs: 0,
            invalidVersionsCustomEnvs: 0,
            invalidVersionsMicrosoftStoreEnvs: 0,
            invalidVersionsGlobalEnvs: 0,
            invalidVersionsOtherVirtualEnvs: 0,
            invalidVersionsPipEnvEnvs: 0,
            invalidVersionsPoetryEnvs: 0,
            invalidVersionsPyenvEnvs: 0,
            invalidVersionsSystemEnvs: 0,
            invalidVersionsUnknownEnvs: 0,
            invalidVersionsVenvEnvs: 0,
            invalidVersionsVirtualEnvEnvs: 0,
            invalidVersionsVirtualEnvWrapperEnvs: 0,
            invalidVersionsOtherGlobalEnvs: 0,
        };
        const invalidSysPrefix = {
            invalidSysPrefixCondaEnvs: 0,
            invalidSysPrefixCustomEnvs: 0,
            invalidSysPrefixMicrosoftStoreEnvs: 0,
            invalidSysPrefixGlobalEnvs: 0,
            invalidSysPrefixOtherVirtualEnvs: 0,
            invalidSysPrefixPipEnvEnvs: 0,
            invalidSysPrefixPoetryEnvs: 0,
            invalidSysPrefixPyenvEnvs: 0,
            invalidSysPrefixSystemEnvs: 0,
            invalidSysPrefixUnknownEnvs: 0,
            invalidSysPrefixVenvEnvs: 0,
            invalidSysPrefixVirtualEnvEnvs: 0,
            invalidSysPrefixVirtualEnvWrapperEnvs: 0,
            invalidSysPrefixOtherGlobalEnvs: 0,
        };

        await Promise.all(
            nativeEnvs.map(async (e) => {
                if (!e.executable) {
                    return;
                }
                if (!(await pathExists(e.executable))) {
                    return;
                }
                const resolvedEnv = await this.resolveEnv(e.executable).catch(noop);
                if (!resolvedEnv) {
                    return;
                }
                const kind = categoryToKind(e.kind);
                const nativeVersion = e.version ? parseVersion(e.version) : undefined;
                if (
                    nativeVersion &&
                    resolvedEnv.version.major > 0 &&
                    resolvedEnv.version.minor > 0 &&
                    resolvedEnv.version.micro > 0 &&
                    nativeVersion.major > 0 &&
                    nativeVersion.minor > 0 &&
                    nativeVersion.micro > 0
                ) {
                    if (
                        resolvedEnv.version.major !== nativeVersion.major ||
                        resolvedEnv.version.micro !== nativeVersion.micro ||
                        resolvedEnv.version.micro !== nativeVersion.micro
                    ) {
                        traceError(
                            `Environment ${e.executable} got the wrong version from native locator (Native = ${e.version}, Actual ${resolvedEnv.version.sysVersion})`,
                        );
                        switch (kind) {
                            case PythonEnvKind.Conda:
                                invalidVersions.invalidVersionsCondaEnvs += 1;
                                break;
                            case PythonEnvKind.Custom:
                                invalidVersions.invalidVersionsCustomEnvs += 1;
                                break;
                            case PythonEnvKind.MicrosoftStore:
                                invalidVersions.invalidVersionsMicrosoftStoreEnvs += 1;
                                break;
                            case PythonEnvKind.OtherGlobal:
                                invalidVersions.invalidVersionsGlobalEnvs += 1;
                                break;
                            case PythonEnvKind.OtherVirtual:
                                invalidVersions.invalidVersionsOtherVirtualEnvs += 1;
                                break;
                            case PythonEnvKind.Pipenv:
                                invalidVersions.invalidVersionsPipEnvEnvs += 1;
                                break;
                            case PythonEnvKind.Poetry:
                                invalidVersions.invalidVersionsPoetryEnvs += 1;
                                break;
                            case PythonEnvKind.Pyenv:
                                invalidVersions.invalidVersionsPyenvEnvs += 1;
                                break;
                            case PythonEnvKind.System:
                                invalidVersions.invalidVersionsSystemEnvs += 1;
                                break;
                            case PythonEnvKind.Unknown:
                                invalidVersions.invalidVersionsUnknownEnvs += 1;
                                break;
                            case PythonEnvKind.Venv:
                                invalidVersions.invalidVersionsVenvEnvs += 1;
                                break;
                            case PythonEnvKind.VirtualEnv:
                                invalidVersions.invalidVersionsVirtualEnvEnvs += 1;
                                break;
                            case PythonEnvKind.VirtualEnvWrapper:
                                invalidVersions.invalidVersionsVirtualEnvWrapperEnvs += 1;
                                break;
                            case PythonEnvKind.ActiveState:
                            case PythonEnvKind.Hatch:
                            case PythonEnvKind.Pixi:
                                // Do nothing.
                                break;
                            default:
                                break;
                        }
                    }
                }
                if (e.prefix && resolvedEnv.executable.sysPrefix.toLowerCase() !== e.prefix.trim().toLowerCase()) {
                    traceError(
                        `Environment ${e.executable} got the wrong Sys.Prefix from native locator (Native = ${e.prefix}, Actual ${resolvedEnv.executable.sysPrefix})`,
                    );
                    switch (kind) {
                        case PythonEnvKind.Conda:
                            invalidSysPrefix.invalidSysPrefixCondaEnvs += 1;
                            break;
                        case PythonEnvKind.Custom:
                            invalidSysPrefix.invalidSysPrefixCustomEnvs += 1;
                            break;
                        case PythonEnvKind.MicrosoftStore:
                            invalidSysPrefix.invalidSysPrefixMicrosoftStoreEnvs += 1;
                            break;
                        case PythonEnvKind.OtherGlobal:
                            invalidSysPrefix.invalidSysPrefixGlobalEnvs += 1;
                            break;
                        case PythonEnvKind.OtherVirtual:
                            invalidSysPrefix.invalidSysPrefixOtherVirtualEnvs += 1;
                            break;
                        case PythonEnvKind.Pipenv:
                            invalidSysPrefix.invalidSysPrefixPipEnvEnvs += 1;
                            break;
                        case PythonEnvKind.Poetry:
                            invalidSysPrefix.invalidSysPrefixPoetryEnvs += 1;
                            break;
                        case PythonEnvKind.Pyenv:
                            invalidSysPrefix.invalidSysPrefixPyenvEnvs += 1;
                            break;
                        case PythonEnvKind.System:
                            invalidSysPrefix.invalidSysPrefixSystemEnvs += 1;
                            break;
                        case PythonEnvKind.Unknown:
                            invalidSysPrefix.invalidSysPrefixUnknownEnvs += 1;
                            break;
                        case PythonEnvKind.Venv:
                            invalidSysPrefix.invalidSysPrefixVenvEnvs += 1;
                            break;
                        case PythonEnvKind.VirtualEnv:
                            invalidSysPrefix.invalidSysPrefixVirtualEnvEnvs += 1;
                            break;
                        case PythonEnvKind.VirtualEnvWrapper:
                            invalidSysPrefix.invalidSysPrefixVirtualEnvWrapperEnvs += 1;
                            break;
                        case PythonEnvKind.ActiveState:
                        case PythonEnvKind.Hatch:
                        case PythonEnvKind.Pixi:
                            // Do nothing.
                            break;
                        default:
                            break;
                    }
                }
            }),
        );
        sendTelemetryEvent(EventName.PYTHON_INTERPRETER_DISCOVERY_INVALID_NATIVE, 0, {
            ...invalidVersions,
            ...invalidSysPrefix,
        });
    }
}

type CondaTelemetry = {
    condaInfoEnvs: number;
    condaEnvsInEnvDir: number;
    prefixNotExistsCondaEnvs: number;
    condaEnvsWithoutPrefix: number;
    condaDefaultPrefixEnvsAfterFind?: number;
    condaRootPrefixEnvsAfterFind?: number;
    condaRootPrefixFoundInInfoNotInNative?: boolean;
    condaRootPrefixFoundInInfoAfterFind?: boolean;
    condaRootPrefixFoundInInfoAfterFindKind?: string;
    condaRootPrefixFoundAsPrefixOfAnother?: string;
    condaRootPrefixFoundAsAnotherKind?: string;
    condaRootPrefixInCondaExePath?: boolean;
    condaDefaultPrefixFoundInInfoNotInNative?: boolean;
    condaDefaultPrefixFoundInInfoAfterFind?: boolean;
    condaDefaultPrefixFoundInInfoAfterFindKind?: string;
    condaDefaultPrefixFoundAsAnotherKind?: string;
    condaDefaultPrefixFoundAsPrefixOfAnother?: string;
    condaDefaultPrefixInCondaExePath?: boolean;
    condaDefaultPrefixFoundInTxt?: boolean;
    condaRootPrefixFoundInTxt?: boolean;
    canSpawnConda?: boolean;
    nativeCanSpawnConda?: boolean;
    userProvidedEnvFound?: boolean;
    userProvidedCondaExe?: boolean;
    condaInfoEnvsInvalid: number;
    invalidCondaEnvs: number;
    condaInfoEnvsDuplicate: number;
    condaInfoEnvsInvalidPrefix: number;
    condaInfoEnvsDirs: number;
    nativeCondaEnvsInEnvDir: number;
    nativeCondaInfoEnvsDirs?: number;
    condaRcs?: number;
    nativeCondaRcs?: number;
    condaEnvsInTxt?: number;
    nativeCondaRcsNotFound: number;
    nativeCondaEnvDirsNotFound: number;
    nativeCondaEnvDirsNotFoundHasEnvs: number;
    nativeCondaEnvDirsNotFoundHasEnvsInTxt: number;
    nativeCondaEnvTxtSame?: boolean;
    nativeCondaEnvTxtExists?: boolean;
    nativeCondaEnvsFromTxt: number;
    missingNativeCondaEnvsFromTxt: number;
};

async function getCondaEnvironmentsTxt(): Promise<string | undefined> {
    const homeDir = getUserHomeDir();
    if (!homeDir) {
        return undefined;
    }
    return fsPath.join(homeDir, '.conda', 'environments.txt');
}

async function getCondaTelemetry(
    nativeFinder: NativePythonFinder,
    nativeCondaEnvs: NativeEnvInfo[],
    nativeEnvs: NativeEnvInfo[],
): Promise<CondaTelemetry> {
    let envsDirs: string[] = [];
    const userProvidedCondaExe = fsPath.normalize(
        (getConfiguration('python').get<string>(CONDAPATH_SETTING_KEY) || '').trim(),
    );

    const condaTelemetry: CondaTelemetry = {
        condaEnvsInEnvDir: 0,
        condaInfoEnvs: 0,
        prefixNotExistsCondaEnvs: 0,
        condaEnvsWithoutPrefix: 0,
        nativeCondaEnvsInEnvDir: 0,
        userProvidedCondaExe: userProvidedCondaExe.length > 0,
        condaInfoEnvsInvalid: 0,
        invalidCondaEnvs: 0,
        condaInfoEnvsDuplicate: 0,
        condaInfoEnvsInvalidPrefix: 0,
        condaInfoEnvsDirs: 0,
        nativeCondaRcsNotFound: 0,
        nativeCondaEnvDirsNotFound: 0,
        nativeCondaEnvDirsNotFoundHasEnvs: 0,
        nativeCondaEnvDirsNotFoundHasEnvsInTxt: 0,
        nativeCondaEnvsFromTxt: 0,
        missingNativeCondaEnvsFromTxt: 0,
    };

    const [info, nativeCondaInfo, condaEnvsInEnvironmentsTxt, environmentsTxt] = await Promise.all([
        Conda.getConda()
            .catch((ex) => traceError('Failed to get conda info', ex))
            .then((conda) => conda?.getInfo()),
        nativeFinder.getCondaInfo().catch((ex) => traceError(`Failed to get conda info from native locator`, ex)),
        getCondaEnvironmentsTxt()
            .then(async (txtFile) => {
                if (!txtFile) {
                    return [];
                }
                const envs: string[] = [];
                const lines = await readFile(txtFile)
                    .catch(() => '')
                    .then((c) => c.splitLines({ trim: true, removeEmptyEntries: true }));

                await Promise.all(
                    lines.map(async (line) => {
                        if ((await pathExists(line)) && (await isCondaEnvironment(line))) {
                            envs.push(line);
                        }
                    }),
                );
                return envs;
            })
            .catch((ex) => traceError(`Failed to get conda envs from environments.txt`, ex))
            .then((items) => items || []),
        getCondaEnvironmentsTxt().catch(noop),
    ]);

    if (nativeCondaInfo) {
        condaTelemetry.nativeCanSpawnConda = nativeCondaInfo.canSpawnConda;
        condaTelemetry.nativeCondaInfoEnvsDirs = new Set(nativeCondaInfo.envDirs).size;
        condaTelemetry.nativeCondaRcs = new Set(nativeCondaInfo.condaRcs).size;
        condaTelemetry.userProvidedEnvFound = nativeCondaInfo.userProvidedEnvFound;

        const nativeEnvTxt = fsPath.normalize(nativeCondaInfo.environmentsTxt || '');
        condaTelemetry.nativeCondaEnvTxtExists = nativeCondaInfo.environmentsTxtExists === true;
        condaTelemetry.nativeCondaEnvsFromTxt = (nativeCondaInfo.environmentsFromTxt || []).length;
        condaTelemetry.nativeCondaEnvTxtSame = nativeEnvTxt === environmentsTxt;
    }
    condaTelemetry.condaEnvsInTxt = condaEnvsInEnvironmentsTxt.length;
    condaTelemetry.canSpawnConda = !!info;

    // Conda info rcs
    const condaRcFiles = new Set<string>();
    await Promise.all(
        // eslint-disable-next-line camelcase
        [info?.rc_path, info?.user_rc_path, info?.sys_rc_path, ...(info?.config_files || [])].map(async (rc) => {
            if (rc && (await pathExists(rc))) {
                condaRcFiles.add(fsPath.normalize(rc));
            }
        }),
    ).catch(noop);
    const condaRcs = Array.from(condaRcFiles);
    condaTelemetry.condaRcs = condaRcs.length;

    // Find the condarcs that were not found by native finder.
    const nativeCondaRcs = (nativeCondaInfo?.condaRcs || []).map((rc) => fsPath.normalize(rc));
    condaTelemetry.nativeCondaRcsNotFound = condaRcs.filter((rc) => !nativeCondaRcs.includes(rc)).length;

    // Conda info envs
    const validCondaInfoEnvs = new Set<string>();
    const duplicate = new Set<string>();
    // Duplicate, invalid conda environments.
    await Promise.all(
        (info?.envs || []).map(async (e) => {
            if (duplicate.has(e)) {
                condaTelemetry.condaInfoEnvsDuplicate += 1;
                return;
            }
            duplicate.add(e);
            if (!(await pathExists(e))) {
                condaTelemetry.condaInfoEnvsInvalidPrefix += 1;
                return;
            }
            if (!(await isCondaEnvironment(e))) {
                condaTelemetry.condaInfoEnvsInvalid += 1;
                return;
            }
            validCondaInfoEnvs.add(fsPath.normalize(e));
        }),
    );
    const condaInfoEnvs = Array.from(validCondaInfoEnvs);
    condaTelemetry.condaInfoEnvs = validCondaInfoEnvs.size;

    // Conda env_dirs
    const validEnvDirs = new Set<string>();
    await Promise.all(
        // eslint-disable-next-line camelcase
        (info?.envs_dirs || []).map(async (e) => {
            if (await pathExists(e)) {
                validEnvDirs.add(fsPath.normalize(e));
            }
        }),
    );
    condaTelemetry.condaInfoEnvsDirs = validEnvDirs.size;
    envsDirs = Array.from(validEnvDirs);

    // Find the env_dirs that were not found by native finder.
    const nativeCondaEnvDirs = (nativeCondaInfo?.envDirs || []).map((envDir) => fsPath.normalize(envDir));
    const nativeCondaEnvPrefix = nativeCondaEnvs.filter((e) => e.prefix).map((e) => fsPath.normalize(e.prefix || ''));

    envsDirs.forEach((envDir) => {
        if (
            !nativeCondaEnvDirs.includes(envDir) &&
            !nativeCondaEnvDirs.includes(fsPath.join(envDir, 'envs')) &&
            // If we have a native conda env from this env dir, then we're good.
            !nativeCondaEnvPrefix.some((prefix) => prefix.startsWith(envDir))
        ) {
            condaTelemetry.nativeCondaEnvDirsNotFound += 1;

            // Find what conda envs returned by `conda info` belong to this envdir folder.
            // And find which of those envs do not exist in native conda envs
            condaInfoEnvs.forEach((env) => {
                if (env.startsWith(envDir)) {
                    condaTelemetry.nativeCondaEnvDirsNotFoundHasEnvs += 1;

                    // Check if this env was in the environments.txt file.
                    if (condaEnvsInEnvironmentsTxt.includes(env)) {
                        condaTelemetry.nativeCondaEnvDirsNotFoundHasEnvsInTxt += 1;
                    }
                }
            });
        }
    });

    // How many envs are in environments.txt that were not found by native locator.
    condaTelemetry.missingNativeCondaEnvsFromTxt = condaEnvsInEnvironmentsTxt.filter(
        (env) => !nativeCondaEnvPrefix.some((prefix) => prefix === env),
    ).length;

    // How many envs found by native locator & conda info are in the env dirs.
    condaTelemetry.condaEnvsInEnvDir = condaInfoEnvs.filter((e) => envsDirs.some((d) => e.startsWith(d))).length;
    condaTelemetry.nativeCondaEnvsInEnvDir = nativeCondaEnvs.filter((e) =>
        nativeCondaEnvDirs.some((d) => (e.prefix || '').startsWith(d)),
    ).length;

    // Check if we have found the conda env that matches the `root_prefix` in the conda info.
    // eslint-disable-next-line camelcase
    let rootPrefix = info?.root_prefix || '';
    if (rootPrefix && (await pathExists(rootPrefix)) && (await isCondaEnvironment(rootPrefix))) {
        rootPrefix = fsPath.normalize(rootPrefix);
        condaTelemetry.condaRootPrefixInCondaExePath = userProvidedCondaExe
            .toLowerCase()
            .startsWith(rootPrefix.toLowerCase());
        // Check if we have a conda env that matches this prefix but not found in native envs.
        condaTelemetry.condaRootPrefixFoundInInfoNotInNative =
            condaInfoEnvs.some((env) => env.toLowerCase() === rootPrefix.toLowerCase()) &&
            !nativeCondaEnvs.some((e) => fsPath.normalize(e.prefix || '').toLowerCase() === rootPrefix.toLowerCase());
        condaTelemetry.condaRootPrefixFoundInTxt = condaEnvsInEnvironmentsTxt.some(
            (e) => e.toLowerCase() === rootPrefix.toLowerCase(),
        );

        if (condaTelemetry.condaRootPrefixFoundInInfoNotInNative) {
            // Verify we are able to discover this environment as a conda env using native finder.
            const rootPrefixEnvs = await flattenIterable(nativeFinder.refresh([Uri.file(rootPrefix)]));
            // Did we find an env with the same prefix?
            const rootPrefixEnv = rootPrefixEnvs
                .filter(isNativeEnvInfo)
                .find((e) => fsPath.normalize(e.prefix || '').toLowerCase() === rootPrefix.toLowerCase());
            condaTelemetry.condaRootPrefixEnvsAfterFind = rootPrefixEnvs.length;
            condaTelemetry.condaRootPrefixFoundInInfoAfterFind = !!rootPrefixEnv;
            condaTelemetry.condaRootPrefixFoundInInfoAfterFindKind = rootPrefixEnv?.kind;
            condaTelemetry.condaRootPrefixFoundAsAnotherKind = nativeEnvs.find(
                (e) => fsPath.normalize(e.prefix || '').toLowerCase() === rootPrefix.toLowerCase(),
            )?.kind;
            condaTelemetry.condaRootPrefixFoundAsPrefixOfAnother = nativeEnvs.find((e) =>
                fsPath
                    .normalize(e.prefix || '')
                    .toLowerCase()
                    .startsWith(rootPrefix.toLowerCase()),
            )?.kind;
        }
    }

    // eslint-disable-next-line camelcase
    let defaultPrefix = info?.default_prefix || '';
    if (defaultPrefix && (await pathExists(defaultPrefix)) && (await isCondaEnvironment(defaultPrefix))) {
        defaultPrefix = fsPath.normalize(defaultPrefix);
        condaTelemetry.condaDefaultPrefixInCondaExePath = userProvidedCondaExe
            .toLowerCase()
            .startsWith(defaultPrefix.toLowerCase());
        // Check if we have a conda env that matches this prefix but not found in native envs.
        condaTelemetry.condaDefaultPrefixFoundInInfoNotInNative =
            condaInfoEnvs.some((env) => env.toLowerCase() === defaultPrefix.toLowerCase()) &&
            !nativeCondaEnvs.some(
                (e) => fsPath.normalize(e.prefix || '').toLowerCase() === defaultPrefix.toLowerCase(),
            );
        condaTelemetry.condaDefaultPrefixFoundInTxt = condaEnvsInEnvironmentsTxt.some(
            (e) => e.toLowerCase() === rootPrefix.toLowerCase(),
        );

        if (condaTelemetry.condaDefaultPrefixFoundInInfoNotInNative) {
            // Verify we are able to discover this environment as a conda env using native finder.
            const defaultPrefixEnvs = await flattenIterable(nativeFinder.refresh([Uri.file(defaultPrefix)]));
            // Did we find an env with the same prefix?
            const defaultPrefixEnv = defaultPrefixEnvs
                .filter(isNativeEnvInfo)
                .find((e) => fsPath.normalize(e.prefix || '').toLowerCase() === defaultPrefix.toLowerCase());
            condaTelemetry.condaDefaultPrefixEnvsAfterFind = defaultPrefixEnvs.length;
            condaTelemetry.condaDefaultPrefixFoundInInfoAfterFind = !!defaultPrefixEnv;
            condaTelemetry.condaDefaultPrefixFoundInInfoAfterFindKind = defaultPrefixEnv?.kind;
            condaTelemetry.condaDefaultPrefixFoundAsAnotherKind = nativeEnvs.find(
                (e) => fsPath.normalize(e.prefix || '').toLowerCase() === defaultPrefix.toLowerCase(),
            )?.kind;
            condaTelemetry.condaDefaultPrefixFoundAsPrefixOfAnother = nativeEnvs.find((e) =>
                fsPath
                    .normalize(e.prefix || '')
                    .toLowerCase()
                    .startsWith(defaultPrefix.toLowerCase()),
            )?.kind;
        }
    }

    return condaTelemetry;
}
