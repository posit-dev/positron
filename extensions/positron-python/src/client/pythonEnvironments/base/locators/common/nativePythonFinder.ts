// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// --- Start Positron ---
/* eslint-disable import/no-duplicates */
// --- End Positron ---

import { Disposable, EventEmitter, Event, Uri } from 'vscode';
import * as ch from 'child_process';
import * as path from 'path';
import * as rpc from 'vscode-jsonrpc/node';
import { PassThrough } from 'stream';
import * as fs from '../../../../common/platform/fs-paths';
import { isWindows, getUserHomeDir } from '../../../../common/utils/platform';
import { EXTENSION_ROOT_DIR } from '../../../../constants';
import { createDeferred, createDeferredFrom } from '../../../../common/utils/async';
import { DisposableBase, DisposableStore } from '../../../../common/utils/resourceLifecycle';
import { noop } from '../../../../common/utils/misc';
import { getConfiguration, getWorkspaceFolderPaths, isTrusted } from '../../../../common/vscodeApis/workspaceApis';
import { CONDAPATH_SETTING_KEY } from '../../../common/environmentManagers/conda';
import { VENVFOLDERS_SETTING_KEY, VENVPATH_SETTING_KEY } from '../lowLevel/customVirtualEnvLocator';
import { createLogOutputChannel, showWarningMessage } from '../../../../common/vscodeApis/windowApis';
import { sendNativeTelemetry, NativePythonTelemetry } from './nativePythonTelemetry';
import { NativePythonEnvironmentKind } from './nativePythonUtils';
import type { IExtensionContext } from '../../../../common/types';
import { StopWatch } from '../../../../common/utils/stopWatch';
import { untildify } from '../../../../common/helpers';
import { traceError } from '../../../../logging';
import { Common, PythonLocator } from '../../../../common/utils/localize';
import { Commands } from '../../../../common/constants';
import { executeCommand } from '../../../../common/vscodeApis/commandApis';
import { getGlobalStorage, IPersistentStorage } from '../../../../common/persistentState';

// --- Start Positron ---
import { getCustomEnvDirs, isPythonStartupDisabled } from '../../../../positron/interpreterSettings';
import { traceVerbose } from '../../../../logging';
import { ADDITIONAL_POSIX_BIN_PATHS } from '../../../common/posixUtils';
import { PythonEnvSource } from '../../info/index';
import { getUvDirs } from '../../../common/environmentManagers/uv';
// --- End Positron ---

const PYTHON_ENV_TOOLS_PATH = isWindows()
    ? // --- Start Positron ---
      // update path to reflect the location of the PET binary
      path.join(EXTENSION_ROOT_DIR, 'python-env-tools', 'pet.exe')
    : path.join(EXTENSION_ROOT_DIR, 'python-env-tools', 'pet');
// --- End Positron ---

const DONT_SHOW_SPAWN_ERROR_AGAIN = 'DONT_SHOW_NATIVE_FINDER_SPAWN_ERROR_AGAIN';

// --- Start Positron ---
const LOCATOR_IDLE_TIMEOUT_SETTING_KEY = 'locatorIdleTimeout';
// --- End Positron ---

export interface NativeEnvInfo {
    displayName?: string;
    name?: string;
    executable?: string;
    kind?: NativePythonEnvironmentKind;
    version?: string;
    prefix?: string;
    manager?: NativeEnvManagerInfo;
    /**
     * Path to the project directory when dealing with pipenv virtual environments.
     */
    project?: string;
    arch?: 'x64' | 'x86';
    symlinks?: string[];
    // --- Start Positron ---
    source?: PythonEnvSource[];
    // --- End Positron ---
}

export interface NativeEnvManagerInfo {
    tool: string;
    executable: string;
    version?: string;
}

export function isNativeEnvInfo(info: NativeEnvInfo | NativeEnvManagerInfo): info is NativeEnvInfo {
    if ((info as NativeEnvManagerInfo).tool) {
        return false;
    }
    return true;
}

export type NativeCondaInfo = {
    canSpawnConda: boolean;
    userProvidedEnvFound?: boolean;
    condaRcs: string[];
    envDirs: string[];
    environmentsTxt?: string;
    environmentsTxtExists?: boolean;
    environmentsFromTxt: string[];
};

export interface NativePythonFinder extends Disposable {
    /**
     * Refresh the list of python environments.
     * Returns an async iterable that can be used to iterate over the list of python environments.
     * Internally this will take all of the current workspace folders and search for python environments.
     *
     * If a Uri is provided, then it will search for python environments in that location (ignoring workspaces).
     * Uri can be a file or a folder.
     * If a NativePythonEnvironmentKind is provided, then it will search for python environments of that kind (ignoring workspaces).
     */
    refresh(options?: NativePythonEnvironmentKind | Uri[]): AsyncIterable<NativeEnvInfo | NativeEnvManagerInfo>;
    /**
     * Will spawn the provided Python executable and return information about the environment.
     * @param executable
     */
    resolve(executable: string): Promise<NativeEnvInfo>;
    /**
     * Used only for telemetry.
     */
    getCondaInfo(): Promise<NativeCondaInfo>;
    // --- Start Positron ---
    /**
     * The last fatal discovery error (PET failed to spawn/respond), or `undefined` if
     * discovery is operational. Set when the finder process errors, the RPC connection
     * errors, or a refresh request rejects, and cleared when a refresh completes
     * successfully so a recovered PET stops reporting a stale failure; these are
     * otherwise only logged. Read by the environment health check (item 1) to
     * distinguish a broken locator from an empty one.
     */
    readonly lastDiscoveryError: string | undefined;
    /**
     * Process id of the running PET server, or `undefined` when the server is
     * not running (never started, shut down after the idle timeout, or exited).
     * Used by tests and diagnostics.
     */
    readonly serverPid: number | undefined;
    // --- End Positron ---
}

interface NativeLog {
    level: string;
    message: string;
}

// --- Start Positron ---
/**
 * Bridges PET's push-based `discovered` event into a pull-based async generator.
 *
 * Subscribes to `discovered` eagerly (when called, not when first iterated) so
 * environments emitted between starting a refresh and consuming the generator
 * are buffered rather than lost. Yields buffered environments as the consumer
 * pulls them, and finishes only once `completed` has resolved AND every buffered
 * environment has been drained -- a consumer that is slow to pull (e.g. resolving
 * symlinks per environment) must not cause environments buffered during that work
 * to be dropped when the refresh completes. See #14483.
 *
 * @param discovered Event fired once per discovered environment.
 * @param completed Resolves when the underlying refresh has finished; after it
 *   resolves the caller is expected to stop firing `discovered`.
 */
export function bufferedEvents<T>(discovered: Event<T>, completed: Promise<void>): AsyncGenerator<T> {
    const done = createDeferredFrom(completed);
    const buffer: T[] = [];
    let signal = createDeferred<void>();
    const sub = discovered((item) => {
        buffer.push(item);
        signal.resolve();
    });

    async function* drain(): AsyncGenerator<T> {
        try {
            for (;;) {
                if (buffer.length > 0) {
                    const toSend = buffer.splice(0, buffer.length);
                    for (const item of toSend) {
                        yield item;
                    }
                    // Items may have been buffered while the yields above were
                    // suspended on a slow consumer; re-check before waiting/exiting.
                    continue;
                }
                if (done.completed) {
                    return;
                }
                await Promise.race([done.promise, signal.promise]);
                signal = createDeferred<void>();
            }
        } finally {
            sub.dispose();
        }
    }

    return drain();
}
// --- End Positron ---

class NativePythonFinderImpl extends DisposableBase implements NativePythonFinder {
    // --- Start Positron ---
    // private readonly connection: rpc.MessageConnection;
    // The connection and server process are created lazily and can be torn down
    // (idle timeout, crash, dispose) and recreated by the next request.
    private connection: rpc.MessageConnection | undefined;

    private serverProc: ch.ChildProcess | undefined;

    private connectionDisposable: Disposable | undefined;

    public get serverPid(): number | undefined {
        return this.serverProc?.pid;
    }
    // --- End Positron ---

    // --- Start Positron ---
    // private firstRefreshResults: undefined | (() => AsyncGenerator<NativeEnvInfo, void, unknown>);
    private firstRefreshResults: undefined | (() => AsyncGenerator<NativeEnvInfo | NativeEnvManagerInfo>);
    // --- End Positron ---

    private readonly outputChannel = this._register(createLogOutputChannel('Python Locator', { log: true }));

    private initialRefreshMetrics = {
        timeToSpawn: 0,
        timeToConfigure: 0,
        timeToRefresh: 0,
    };

    private readonly suppressErrorNotification: IPersistentStorage<boolean>;

    // --- Start Positron ---
    private _lastDiscoveryError: string | undefined;

    public get lastDiscoveryError(): string | undefined {
        return this._lastDiscoveryError;
    }
    // --- End Positron ---

    constructor(private readonly cacheDirectory?: Uri, private readonly context?: IExtensionContext) {
        super();
        this.suppressErrorNotification = this.context
            ? getGlobalStorage<boolean>(this.context, DONT_SHOW_SPAWN_ERROR_AGAIN, false)
            : ({ get: () => false, set: async () => {} } as IPersistentStorage<boolean>);
        // --- Start Positron ---
        // this.connection = this.start();
        // The connection now starts lazily via ensureConnection(); make sure the
        // server is stopped when the finder itself is disposed.
        this._register(new Disposable(() => this.shutdownServer()));
        // void this.configure();
        // this.firstRefreshResults = this.refreshFirstTime();
        // When Python startup is disabled, skip the eager configure and first
        // refresh so no PET server spawns at startup; discovery still works
        // lazily when explicitly requested.
        if (!isPythonStartupDisabled()) {
            void this.configure();
            this.firstRefreshResults = this.refreshFirstTime();
        }
        // --- End Positron ---
    }

    // --- Start Positron ---
    // Positron wrapper: counts the request so the idle timer stays disarmed while
    // it runs, then delegates to the upstream body (renamed to `resolveImpl`).
    // Wrapping rather than re-indenting keeps the upstream body byte-identical,
    // so upstream merges do not conflict on it. Mirrors configure/configureImpl.
    public resolve(executable: string): Promise<NativeEnvInfo> {
        return this.trackRequest(() => this.resolveImpl(executable));
    }

    private async resolveImpl(executable: string): Promise<NativeEnvInfo> {
        // --- End Positron ---
        await this.configure();
        // --- Start Positron ---
        // const environment = await this.connection.sendRequest<NativeEnvInfo>('resolve', {
        const environment = await this.ensureConnection().sendRequest<NativeEnvInfo>('resolve', {
            // --- End Positron ---
            executable,
        });

        this.outputChannel.info(`Resolved Python Environment ${environment.executable}`);
        return environment;
    }

    // --- Start Positron ---
    // async *refresh(options?: NativePythonEnvironmentKind | Uri[]): AsyncIterable<NativeEnvInfo> {
    async *refresh(options?: NativePythonEnvironmentKind | Uri[]): AsyncIterable<NativeEnvInfo | NativeEnvManagerInfo> {
        // --- End Positron ---
        if (this.firstRefreshResults) {
            // If this is the first time we are refreshing,
            // Then get the results from the first refresh.
            // Those would have started earlier and cached in memory.
            const results = this.firstRefreshResults();
            this.firstRefreshResults = undefined;
            yield* results;
        } else {
            const result = this.doRefresh(options);
            // --- Start Positron ---
            // Use the shared buffering bridge so environments discovered while the
            // consumer is busy are not dropped when the refresh completes (#14483).
            yield* bufferedEvents(result.discovered, result.completed);
            // --- End Positron ---
        }
    }

    refreshFirstTime() {
        const result = this.doRefresh();
        // --- Start Positron ---
        // Subscribe eagerly (now, in the constructor's call) so environments PET
        // emits before the first consumer pulls are buffered rather than lost;
        // bufferedEvents drains them when the returned generator is iterated (#14483).
        const generator = bufferedEvents(result.discovered, result.completed);
        return () => generator;
        // --- End Positron ---
    }

    // --- Start Positron ---
    /**
     * Returns the JSON-RPC connection to the PET server, spawning the server
     * if it is not currently running (first use, after the idle timeout, or
     * after a crash).
     */
    private ensureConnection(): rpc.MessageConnection {
        if (!this.connection) {
            this.connection = this.start();
        }
        return this.connection;
    }

    /**
     * Stops the PET server and disposes the JSON-RPC connection. Safe to call
     * when the server is not running. The next request respawns the server.
     */
    private inFlightRequests = 0;

    private idleTimer: NodeJS.Timeout | undefined;

    /** Marks the start of a PET request; suspends the idle timer. */
    private beginRequest(): void {
        this.inFlightRequests += 1;
        this.clearIdleTimer();
    }

    /** Marks the end of a PET request; arms the idle timer when none remain. */
    private endRequest(): void {
        this.inFlightRequests = Math.max(0, this.inFlightRequests - 1);
        if (this.inFlightRequests === 0 && this.connection) {
            this.armIdleTimer();
        }
    }

    /**
     * Runs a PET request with idle-timer accounting, so the server is never shut
     * down underneath an in-flight request. Lets the upstream method bodies stay
     * untouched: the exported method becomes a one-line wrapper around this and
     * the original body keeps its shape as an `Impl` method.
     */
    private async trackRequest<T>(run: () => Promise<T>): Promise<T> {
        this.beginRequest();
        try {
            return await run();
        } finally {
            this.endRequest();
        }
    }

    private clearIdleTimer(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = undefined;
        }
    }

    /**
     * Schedules an idle shutdown of the PET server. The timeout is read live
     * from `python.locatorIdleTimeout` (seconds) so setting changes apply
     * without a reload; 0 (or a negative value) disables the shutdown.
     */
    private armIdleTimer(): void {
        this.clearIdleTimer();
        const timeoutSeconds = getConfiguration('python').get<number>(LOCATOR_IDLE_TIMEOUT_SETTING_KEY, 180);
        if (!timeoutSeconds || timeoutSeconds <= 0) {
            return;
        }
        this.idleTimer = setTimeout(() => {
            this.idleTimer = undefined;
            if (this.inFlightRequests === 0 && this.connection) {
                this.outputChannel.info(
                    `Shutting down Python Locator server after ${timeoutSeconds}s idle; it restarts on the next request`,
                );
                this.shutdownServer();
            }
        }, timeoutSeconds * 1000);
    }

    /**
     * Clears the cached connection state once `proc`'s server is gone, whether it
     * exited, failed to spawn, or its RPC connection errored, so the next request
     * starts a fresh server instead of reusing a dead one. Identity-guarded: a
     * late event from a superseded server must not clobber its replacement.
     */
    private handleServerGone(proc: ch.ChildProcess): void {
        if (this.serverProc !== proc) {
            return;
        }
        const disposable = this.connectionDisposable;
        this.serverProc = undefined;
        this.connection = undefined;
        this.connectionDisposable = undefined;
        this.lastConfiguration = undefined;
        this.clearIdleTimer();
        // Dispose rather than just drop: disposing the RPC connection rejects
        // requests that are still in flight. Without this a request issued
        // against a server that then dies never settles, which is the hang this
        // whole teardown exists to prevent. On a normal exit `connection.onClose`
        // would also get here, but a failed spawn has no close and no exit.
        disposable?.dispose();
    }

    private shutdownServer(): void {
        this.clearIdleTimer();
        const disposable = this.connectionDisposable;
        this.connectionDisposable = undefined;
        this.connection = undefined;
        this.lastConfiguration = undefined;
        disposable?.dispose();
    }
    // --- End Positron ---

    // eslint-disable-next-line class-methods-use-this
    private start(): rpc.MessageConnection {
        this.outputChannel.info(`Starting Python Locator ${PYTHON_ENV_TOOLS_PATH} server`);

        // jsonrpc package cannot handle messages coming through too quickly.
        // Lets handle the messages and close the stream only when
        // we have got the exit event.
        const readable = new PassThrough();
        const writable = new PassThrough();
        const disposables: Disposable[] = [];
        try {
            const stopWatch = new StopWatch();
            const proc = ch.spawn(PYTHON_ENV_TOOLS_PATH, ['server'], { env: process.env });
            this.initialRefreshMetrics.timeToSpawn = stopWatch.elapsedTime;
            // --- Start Positron ---
            this.serverProc = proc;
            // --- End Positron ---
            proc.stdout.pipe(readable, { end: false });
            proc.stderr.on('data', (data) => this.outputChannel.error(data.toString()));
            writable.pipe(proc.stdin, { end: false });

            // Handle spawn errors (e.g., missing DLLs on Windows)
            proc.on('error', (error) => {
                this.outputChannel.error(`Python Locator process error: ${error.message}`);
                this.outputChannel.error(`Error details: ${JSON.stringify(error)}`);
                // --- Start Positron ---
                this._lastDiscoveryError = error.message;
                // A process that never started must not stay cached as the current
                // server: Node may emit 'error' without a following 'exit', so this
                // is the only teardown some spawn failures get.
                this.handleServerGone(proc);
                // eslint-disable-next-line @typescript-eslint/no-use-before-define
                disposeStreams.dispose();
                // --- End Positron ---
                this.handleSpawnError(error.message);
            });

            // Handle immediate exits with error codes
            let hasStarted = false;
            setTimeout(() => {
                hasStarted = true;
            }, 1000);

            proc.on('exit', (code, signal) => {
                if (!hasStarted && code !== null && code !== 0) {
                    const errorMessage = `Python Locator process exited immediately with code ${code}`;
                    this.outputChannel.error(errorMessage);
                    if (signal) {
                        this.outputChannel.error(`Exit signal: ${signal}`);
                    }
                    // --- Start Positron ---
                    this._lastDiscoveryError = errorMessage;
                    // --- End Positron ---
                    this.handleSpawnError(errorMessage);
                }
                // --- Start Positron ---
                // Tear down the RPC plumbing whenever the server exits, expected
                // or not. The stdio pipes use { end: false }, so without this the
                // connection never closes and any later request hangs forever
                // instead of respawning the server.
                this.handleServerGone(proc);
                // `disposeStreams` is declared after this try block, but the exit
                // handler only runs on a later event-loop turn, so it is always
                // initialized by then; `connection.onError` relies on this too.
                // eslint-disable-next-line @typescript-eslint/no-use-before-define
                disposeStreams.dispose();
                // --- End Positron ---
            });

            disposables.push({
                dispose: () => {
                    try {
                        if (proc.exitCode === null) {
                            proc.kill();
                        }
                    } catch (ex) {
                        this.outputChannel.error('Error disposing finder', ex);
                    }
                },
            });
        } catch (ex) {
            this.outputChannel.error(`Error starting Python Finder ${PYTHON_ENV_TOOLS_PATH} server`, ex);
        }
        // --- Start Positron ---
        // The spawned process, captured outside the try block above so the
        // connection-level handlers below can identity-guard their teardown.
        const spawnedProc = this.serverProc;
        // --- End Positron ---
        const disposeStreams = new Disposable(() => {
            readable.end();
            writable.end();
        });
        const connection = rpc.createMessageConnection(
            new rpc.StreamMessageReader(readable),
            new rpc.StreamMessageWriter(writable),
        );
        disposables.push(
            connection,
            disposeStreams,
            connection.onError((ex) => {
                disposeStreams.dispose();
                this.outputChannel.error('Connection Error:', ex);
                // --- Start Positron ---
                this._lastDiscoveryError = `Connection error: ${String(ex)}`;
                // The streams are dead, so this connection can never serve another
                // request; drop it so the next one starts a fresh server.
                if (spawnedProc) {
                    this.handleServerGone(spawnedProc);
                }
                // --- End Positron ---
            }),
            connection.onNotification('log', (data: NativeLog) => {
                switch (data.level) {
                    case 'info':
                        this.outputChannel.info(data.message);
                        break;
                    case 'warning':
                        this.outputChannel.warn(data.message);
                        break;
                    case 'error':
                        this.outputChannel.error(data.message);
                        break;
                    case 'debug':
                        this.outputChannel.debug(data.message);
                        break;
                    default:
                        this.outputChannel.trace(data.message);
                }
            }),
            connection.onNotification('telemetry', (data: NativePythonTelemetry) =>
                sendNativeTelemetry(data, this.initialRefreshMetrics),
            ),
            connection.onClose(() => {
                disposables.forEach((d) => d.dispose());
            }),
        );

        connection.listen();
        // --- Start Positron ---
        // this._register(Disposable.from(...disposables));
        // Held per-connection instead of on the class store so shutdownServer()
        // can dispose one server's resources without leaking entries across
        // respawns; the class-level dispose runs shutdownServer().
        this.connectionDisposable = Disposable.from(...disposables);
        // --- End Positron ---
        return connection;
    }

    private doRefresh(options?: NativePythonEnvironmentKind | Uri[]): {
        completed: Promise<void>;
        discovered: Event<NativeEnvInfo | NativeEnvManagerInfo>;
    } {
        // --- Start Positron ---
        // All notification handlers and requests in this refresh must target one
        // and the same server instance, so capture the connection once.
        this.beginRequest();
        const connection = this.ensureConnection();
        // --- End Positron ---
        const disposable = this._register(new DisposableStore());
        const discovered = disposable.add(new EventEmitter<NativeEnvInfo | NativeEnvManagerInfo>());
        const completed = createDeferred<void>();
        const pendingPromises: Promise<void>[] = [];
        const stopWatch = new StopWatch();

        const notifyUponCompletion = () => {
            const initialCount = pendingPromises.length;
            Promise.all(pendingPromises)
                .then(() => {
                    if (initialCount === pendingPromises.length) {
                        completed.resolve();
                    } else {
                        setTimeout(notifyUponCompletion, 0);
                    }
                })
                .catch(noop);
        };
        const trackPromiseAndNotifyOnCompletion = (promise: Promise<void>) => {
            pendingPromises.push(promise);
            notifyUponCompletion();
        };

        // Assumption is server will ensure there's only one refresh at a time.
        // Perhaps we should have a request Id or the like to map the results back to the `refresh` request.
        disposable.add(
            // --- Start Positron ---
            // this.connection.onNotification('environment', (data: NativeEnvInfo) => {
            connection.onNotification('environment', (data: NativeEnvInfo) => {
                // --- End Positron ---
                this.outputChannel.info(`Discovered env: ${data.executable || data.prefix}`);
                // We know that in the Python extension if either Version of Prefix is not provided by locator
                // Then we end up resolving the information.
                // Lets do that here,
                // This is a hack, as the other part of the code that resolves the version information
                // doesn't work as expected, as its still a WIP.
                if (data.executable && (!data.version || !data.prefix)) {
                    // HACK = TEMPORARY WORK AROUND, TO GET STUFF WORKING
                    // HACK = TEMPORARY WORK AROUND, TO GET STUFF WORKING
                    // HACK = TEMPORARY WORK AROUND, TO GET STUFF WORKING
                    // HACK = TEMPORARY WORK AROUND, TO GET STUFF WORKING
                    // --- Start Positron ---
                    // const promise = this.connection
                    const promise = connection
                        // --- End Positron ---
                        .sendRequest<NativeEnvInfo>('resolve', {
                            executable: data.executable,
                        })
                        .then((environment) => {
                            this.outputChannel.info(`Resolved ${environment.executable}`);
                            discovered.fire(environment);
                        })
                        .catch((ex) => this.outputChannel.error(`Error in Resolving ${JSON.stringify(data)}`, ex));
                    trackPromiseAndNotifyOnCompletion(promise);
                } else {
                    discovered.fire(data);
                }
            }),
        );
        disposable.add(
            // --- Start Positron ---
            // this.connection.onNotification('manager', (data: NativeEnvManagerInfo) => {
            connection.onNotification('manager', (data: NativeEnvManagerInfo) => {
                // --- End Positron ---
                this.outputChannel.info(`Discovered manager: (${data.tool}) ${data.executable}`);
                discovered.fire(data);
            }),
        );

        type RefreshOptions = {
            searchKind?: NativePythonEnvironmentKind;
            searchPaths?: string[];
        };

        const refreshOptions: RefreshOptions = {};
        if (options && Array.isArray(options) && options.length > 0) {
            refreshOptions.searchPaths = options.map((item) => item.fsPath);
        } else if (options && typeof options === 'string') {
            refreshOptions.searchKind = options;
        }
        trackPromiseAndNotifyOnCompletion(
            this.configure().then(() =>
                // --- Start Positron ---
                // this.connection
                connection
                    // --- End Positron ---
                    .sendRequest<{ duration: number }>('refresh', refreshOptions)
                    .then(({ duration }) => {
                        this.outputChannel.info(`Refresh completed in ${duration}ms`);
                        this.initialRefreshMetrics.timeToRefresh = stopWatch.elapsedTime;
                        // --- Start Positron ---
                        this._lastDiscoveryError = undefined;
                        // --- End Positron ---
                    })
                    .catch((ex) => {
                        this.outputChannel.error('Refresh error', ex);
                        // --- Start Positron ---
                        this._lastDiscoveryError = `Refresh error: ${ex instanceof Error ? ex.message : String(ex)}`;
                        // --- End Positron ---
                    }),
            ),
        );

        // --- Start Positron ---
        // completed.promise.finally(() => disposable.dispose());
        completed.promise.finally(() => {
            disposable.dispose();
            this.endRequest();
        });
        // --- End Positron ---
        return {
            completed: completed.promise,
            discovered: discovered.event,
        };
    }

    private lastConfiguration?: ConfigurationOptions;

    // --- Start Positron ---
    // Serializes configure requests. PET (as of 2026.12) reports zero environments
    // if a `refresh` is processed while a `configure` is still in flight. At startup
    // the constructor fires `void this.configure()` and the first refresh
    // (`refreshFirstTime`) concurrently; the two `configure()` calls race and the
    // `lastConfiguration` short-circuit below let the refresh's request go out before
    // the in-flight configure was acknowledged, so discovery came back empty. Chaining
    // each configure() after the previous one guarantees a caller that sends `refresh`
    // next never races an unfinished configure. See #14483.
    private configureQueue: Promise<void> = Promise.resolve();
    // --- End Positron ---

    /**
     * Configuration request, this must always be invoked before any other request.
     * Must be invoked when ever there are changes to any data related to the configuration details.
     */
    // --- Start Positron ---
    private configure(): Promise<void> {
        this.beginRequest();
        const next = this.configureQueue.then(() => this.configureImpl());
        // A failed configure must not poison the queue for later callers; the
        // returned promise still rejects so this caller observes the failure.
        this.configureQueue = next.catch(() => undefined);
        return next.finally(() => this.endRequest());
    }

    private async configureImpl() {
        // --- End Positron ---
        const options: ConfigurationOptions = {
            workspaceDirectories: getWorkspaceFolderPaths(),
            // We do not want to mix this with `search_paths`
            // --- Start Positron ---
            // environmentDirectories: getCustomVirtualEnvDirs(),
            environmentDirectories: await getEnvironmentDirs(),
            // --- End Positron ---
            condaExecutable: getPythonSettingAndUntildify<string>(CONDAPATH_SETTING_KEY),
            poetryExecutable: getPythonSettingAndUntildify<string>('poetryPath'),
            cacheDirectory: this.cacheDirectory?.fsPath,
        };
        // No need to send a configuration request, is there are no changes.
        if (JSON.stringify(options) === JSON.stringify(this.lastConfiguration || {})) {
            return;
        }
        try {
            const stopWatch = new StopWatch();
            this.lastConfiguration = options;
            // --- Start Positron ---
            // await this.connection.sendRequest('configure', options);
            await this.ensureConnection().sendRequest('configure', options);
            // --- End Positron ---
            this.initialRefreshMetrics.timeToConfigure = stopWatch.elapsedTime;
        } catch (ex) {
            this.outputChannel.error('Refresh error', ex);
        }
    }

    // --- Start Positron ---
    // Positron wrapper, as for resolve() above.
    getCondaInfo(): Promise<NativeCondaInfo> {
        return this.trackRequest(() => this.getCondaInfoImpl());
    }

    private async getCondaInfoImpl(): Promise<NativeCondaInfo> {
        // --- End Positron ---
        // --- Start Positron ---
        // return this.connection.sendRequest<NativeCondaInfo>('condaInfo');
        return this.ensureConnection().sendRequest<NativeCondaInfo>('condaInfo');
        // --- End Positron ---
    }

    private async handleSpawnError(errorMessage: string): Promise<void> {
        // Check if user has chosen to not see this error again
        if (this.suppressErrorNotification.get()) {
            return;
        }

        // Check for Windows runtime DLL issues
        if (isWindows() && errorMessage.toLowerCase().includes('vcruntime')) {
            this.outputChannel.error(PythonLocator.windowsRuntimeMissing);
        } else if (isWindows()) {
            this.outputChannel.error(PythonLocator.windowsStartupFailed);
        }

        // Show notification to user
        const selection = await showWarningMessage(
            PythonLocator.startupFailedNotification,
            Common.openOutputPanel,
            Common.doNotShowAgain,
        );

        if (selection === Common.openOutputPanel) {
            await executeCommand(Commands.ViewOutput);
        } else if (selection === Common.doNotShowAgain) {
            await this.suppressErrorNotification.set(true);
        }
    }
}

type ConfigurationOptions = {
    workspaceDirectories: string[];
    /**
     * Place where virtual envs and the like are stored
     * Should not contain workspace folders.
     */
    environmentDirectories: string[];
    condaExecutable: string | undefined;
    poetryExecutable: string | undefined;
    cacheDirectory?: string;
};
/**
 * Gets all custom virtual environment locations to look for environments.
 */
function getCustomVirtualEnvDirs(): string[] {
    const venvDirs: string[] = [];
    const venvPath = getPythonSettingAndUntildify<string>(VENVPATH_SETTING_KEY);
    if (venvPath) {
        venvDirs.push(untildify(venvPath));
    }
    const venvFolders = getPythonSettingAndUntildify<string[]>(VENVFOLDERS_SETTING_KEY) ?? [];
    const homeDir = getUserHomeDir();
    if (homeDir) {
        venvFolders
            .map((item) => (item.startsWith(homeDir) ? item : path.join(homeDir, item)))
            .forEach((d) => venvDirs.push(d));
        venvFolders.forEach((item) => venvDirs.push(untildify(item)));
    }
    return Array.from(new Set(venvDirs));
}

// --- Start Positron ---
/**
 * Gets the list of directories to search for Python environments.
 * @returns List of directories to search for Python environments.
 */
async function getEnvironmentDirs(): Promise<string[]> {
    const venvDirs = getCustomVirtualEnvDirs();
    const additionalDirs = await getAdditionalEnvDirs();
    const uniqueEnvDirs = new Set([...venvDirs, ...additionalDirs]);
    return Array.from(uniqueEnvDirs);
}

/**
 * Gets the list of additional directories to add to environment directories.
 * @returns List of directories to add to environment directories.
 */
export async function getAdditionalEnvDirs(): Promise<string[]> {
    const additionalDirs: string[] = [];

    // Add additional dirs to search for Python environments on non-Windows platforms.
    // See JS locator equivalent `getAdditionalPosixBinaries` in extensions/positron-python/src/client/pythonEnvironments/base/locators/lowLevel/posixKnownPathsLocator.ts
    if (!isWindows()) {
        additionalDirs.push(...ADDITIONAL_POSIX_BIN_PATHS);
    }

    // Add uv dirs, if any.
    const uvDirs = await getUvDirs();
    additionalDirs.push(...uvDirs);

    // Add user-specified Python search directories.
    // See JS locator equivalent in extensions/positron-python/src/client/pythonEnvironments/base/locators/lowLevel/userSpecifiedEnvLocator.ts
    const customEnvDirs = getCustomEnvDirs();
    additionalDirs.push(...customEnvDirs);

    // Return the list of additional directories.
    const uniqueDirs = Array.from(new Set(additionalDirs));
    traceVerbose(
        `[getAdditionalEnvDirs] Found ${
            uniqueDirs.length
        } additional directories to search for Python environments: ${uniqueDirs.map((dir) => `"${dir}"`).join(', ')}`,
    );
    return uniqueDirs;
}
// --- End Positron ---

function getPythonSettingAndUntildify<T>(name: string, scope?: Uri): T | undefined {
    const value = getConfiguration('python', scope).get<T>(name);
    if (typeof value === 'string') {
        return value ? (untildify(value as string) as unknown as T) : undefined;
    }
    return value;
}

let _finder: NativePythonFinder | undefined;
export function getNativePythonFinder(context?: IExtensionContext): NativePythonFinder {
    if (!isTrusted()) {
        return {
            async *refresh() {
                traceError('Python discovery not supported in untrusted workspace');
                yield* [];
            },
            async resolve() {
                traceError('Python discovery not supported in untrusted workspace');
                return {};
            },
            async getCondaInfo() {
                traceError('Python discovery not supported in untrusted workspace');
                return {} as unknown as NativeCondaInfo;
            },
            // --- Start Positron ---
            lastDiscoveryError: undefined,
            serverPid: undefined,
            // --- End Positron ---
            dispose() {
                // do nothing
            },
        };
    }
    if (!_finder) {
        const cacheDirectory = context ? getCacheDirectory(context) : undefined;
        _finder = new NativePythonFinderImpl(cacheDirectory, context);
        if (context) {
            context.subscriptions.push(_finder);
        }
    }
    return _finder;
}

// --- Start Positron ---
/**
 * Test-only: constructs a fresh finder, bypassing the module-level singleton,
 * so lifecycle tests can create and dispose independent instances.
 */
export function createNativePythonFinder(cacheDirectory?: Uri, context?: IExtensionContext): NativePythonFinder {
    return new NativePythonFinderImpl(cacheDirectory, context);
}
// --- End Positron ---

export function getCacheDirectory(context: IExtensionContext): Uri {
    return Uri.joinPath(context.globalStorageUri, 'pythonLocator');
}

export async function clearCacheDirectory(context: IExtensionContext): Promise<void> {
    const cacheDirectory = getCacheDirectory(context);
    await fs.emptyDir(cacheDirectory.fsPath).catch(noop);
}
