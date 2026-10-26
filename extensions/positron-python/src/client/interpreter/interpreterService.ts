// eslint-disable-next-line max-classes-per-file
import { inject, injectable } from 'inversify';
import * as pathUtils from 'path';
import {
    ConfigurationChangeEvent,
    Disposable,
    Event,
    EventEmitter,
    ProgressLocation,
    ProgressOptions,
    Uri,
    WorkspaceFolder,
} from 'vscode';
import '../common/extensions';
import { IApplicationShell, IDocumentManager, IWorkspaceService } from '../common/application/types';
import {
    IConfigurationService,
    IDisposableRegistry,
    IInstaller,
    IInterpreterPathService,
    // --- Start Positron ---
    InterpreterConfigurationScope,
    // --- End Positron ---
    Product,
} from '../common/types';
import { IServiceContainer } from '../ioc/types';
import { PythonEnvironment } from '../pythonEnvironments/info';
import {
    IActivatedEnvironmentLaunch,
    IComponentAdapter,
    GetActiveInterpreterOptions,
    IInterpreterDisplay,
    IInterpreterService,
    IInterpreterStatusbarVisibilityFilter,
    // --- Start Positron ---
    InterpreterChangeEvent,
    // --- End Positron ---
    PythonEnvironmentsChangedEvent,
} from './contracts';
// --- Start Positron ---
import { traceError, traceInfo, traceLog } from '../logging';
// --- End Positron ---
import { Commands, PVSC_EXTENSION_ID, PYTHON_LANGUAGE } from '../common/constants';
import { reportActiveInterpreterChanged } from '../environmentApi';
import { IPythonExecutionFactory } from '../common/process/types';
import { Interpreters } from '../common/utils/localize';
import { sendTelemetryEvent } from '../telemetry';
import { EventName } from '../telemetry/constants';
import { cache } from '../common/utils/decorators';
import {
    GetRefreshEnvironmentsOptions,
    PythonLocatorQuery,
    TriggerRefreshOptions,
} from '../pythonEnvironments/base/locator';
import { sleep } from '../common/utils/async';
import { useEnvExtension } from '../envExt/api.internal';
import { getActiveInterpreterLegacy } from '../envExt/api.legacy';

type StoredPythonEnvironment = PythonEnvironment & { store?: boolean };

// --- Start Positron ---
// getActiveInterpreter always waits for the real resolution; see getActiveInterpreter.
// // Upper bound on how long `getActiveInterpreter` may block its caller. Resolving the active
// // interpreter can wait on a full environment refresh (especially with the environments
// // extension enabled), which would otherwise delay language server startup.
// const GET_ACTIVE_INTERPRETER_TIMEOUT_MS = 100;
// const ACTIVE_INTERPRETER_TIMED_OUT = Symbol('activeInterpreterTimedOut');
//
// // Key prefix for the persisted (cross-restart) last-known active interpreter, one entry per workspace.
// const LAST_KNOWN_ACTIVE_INTERPRETER_KEY_PREFIX = 'lastKnownActiveInterpreter:';
// --- End Positron ---

@injectable()
export class InterpreterService implements Disposable, IInterpreterService {
    public async hasInterpreters(
        filter: (e: PythonEnvironment) => Promise<boolean> = async () => true,
    ): Promise<boolean> {
        return this.pyenvs.hasInterpreters(filter);
    }

    public triggerRefresh(query?: PythonLocatorQuery, options?: TriggerRefreshOptions): Promise<void> {
        return this.pyenvs.triggerRefresh(query, options);
    }

    public get refreshPromise(): Promise<void> | undefined {
        return this.pyenvs.getRefreshPromise();
    }

    public getRefreshPromise(options?: GetRefreshEnvironmentsOptions): Promise<void> | undefined {
        return this.pyenvs.getRefreshPromise(options);
    }

    // --- Start Positron ---
    // public get onDidChangeInterpreter(): Event<Uri | undefined> {
    public get onDidChangeInterpreter(): Event<InterpreterChangeEvent> {
        return this.didChangeInterpreterEmitter.event;
    }
    // --- End Positron ---

    public onDidChangeInterpreters: Event<PythonEnvironmentsChangedEvent>;

    public get onDidChangeInterpreterInformation(): Event<PythonEnvironment> {
        return this.didChangeInterpreterInformation.event;
    }

    public get onDidChangeInterpreterConfiguration(): Event<Uri | undefined> {
        return this.didChangeInterpreterConfigurationEmitter.event;
    }

    // --- Start Positron ---
    // Keyed by getWorkspaceFolderIdentifier(resource) so changes in one folder don't mask another.
    // public _pythonPathSetting: string | undefined = '';
    public _pythonPathSetting: Map<string, string> = new Map();
    // --- End Positron ---

    private readonly didChangeInterpreterConfigurationEmitter = new EventEmitter<Uri | undefined>();

    private readonly configService: IConfigurationService;

    private readonly interpreterPathService: IInterpreterPathService;

    // --- Start Positron ---
    // rivate readonly didChangeInterpreterEmitter = new EventEmitter<Uri | undefined>();
    private readonly didChangeInterpreterEmitter = new EventEmitter<InterpreterChangeEvent>();
    // --- End Positron ---

    private readonly didChangeInterpreterInformation = new EventEmitter<PythonEnvironment>();

    private readonly activeInterpreterPaths = new Map<
        string,
        { path: string; workspaceFolder: WorkspaceFolder | undefined }
    >();

    // --- Start Positron ---
    // Unused because getActiveInterpreter always waits for the real resolution.
    // // Last successfully resolved active interpreter per workspace, served when a resolution
    // // doesn't complete within `GET_ACTIVE_INTERPRETER_TIMEOUT_MS`.
    // private readonly lastKnownActiveInterpreter = new Map<
    //     string,
    //     { resource: Uri | undefined; env: StoredPythonEnvironment | undefined }
    // >();
    //
    // // In-flight active interpreter resolutions, de-duplicated per workspace.
    // private readonly inFlightActiveInterpreter = new Map<string, Promise<StoredPythonEnvironment | undefined>>();
    //
    // // Persisted (cross-restart) last-known active interpreter, one persistent-state handle per workspace.
    // // Lets a warm start serve a real interpreter within the timeout budget before discovery completes.
    // private readonly persistedActiveInterpreter = new Map<
    //     string,
    //     IPersistentState<StoredPythonEnvironment | undefined>
    // >();
    // --- End Positron ---

    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(IComponentAdapter) private readonly pyenvs: IComponentAdapter,
    ) {
        this.configService = this.serviceContainer.get<IConfigurationService>(IConfigurationService);
        this.interpreterPathService = this.serviceContainer.get<IInterpreterPathService>(IInterpreterPathService);
        this.onDidChangeInterpreters = pyenvs.onChanged;
    }

    public async refresh(resource?: Uri): Promise<void> {
        const interpreterDisplay = this.serviceContainer.get<IInterpreterDisplay>(IInterpreterDisplay);
        await interpreterDisplay.refresh(resource);
        const workspaceFolder = this.serviceContainer
            .get<IWorkspaceService>(IWorkspaceService)
            .getWorkspaceFolder(resource);
        const path = this.configService.getSettings(resource).pythonPath;
        const workspaceKey = this.serviceContainer
            .get<IWorkspaceService>(IWorkspaceService)
            .getWorkspaceFolderIdentifier(resource);
        this.activeInterpreterPaths.set(workspaceKey, { path, workspaceFolder });
        this.ensureEnvironmentContainsPython(path, workspaceFolder).ignoreErrors();
    }

    public initialize(): void {
        const disposables = this.serviceContainer.get<Disposable[]>(IDisposableRegistry);
        const documentManager = this.serviceContainer.get<IDocumentManager>(IDocumentManager);
        const interpreterDisplay = this.serviceContainer.get<IInterpreterDisplay>(IInterpreterDisplay);
        const filter = new (class implements IInterpreterStatusbarVisibilityFilter {
            constructor(
                private readonly docManager: IDocumentManager,
                private readonly configService: IConfigurationService,
                private readonly disposablesReg: IDisposableRegistry,
            ) {
                this.disposablesReg.push(
                    this.configService.onDidChange(async (event: ConfigurationChangeEvent | undefined) => {
                        if (event?.affectsConfiguration('python.interpreter.infoVisibility')) {
                            this.interpreterVisibilityEmitter.fire();
                        }
                    }),
                );
            }

            public readonly interpreterVisibilityEmitter = new EventEmitter<void>();

            public readonly changed = this.interpreterVisibilityEmitter.event;

            get hidden() {
                const visibility = this.configService.getSettings().interpreter.infoVisibility;
                if (visibility === 'never') {
                    return true;
                }
                if (visibility === 'always') {
                    return false;
                }
                const document = this.docManager.activeTextEditor?.document;
                // Output channel for MS Python related extensions. These contain "ms-python" in their ID.
                const pythonOutputChannelPattern = PVSC_EXTENSION_ID.split('.')[0];
                if (
                    document?.fileName.endsWith('settings.json') ||
                    document?.fileName.includes(pythonOutputChannelPattern)
                ) {
                    return false;
                }
                return document?.languageId !== PYTHON_LANGUAGE;
            }
        })(documentManager, this.configService, disposables);
        interpreterDisplay.registerVisibilityFilter(filter);
        disposables.push(
            this.onDidChangeInterpreters((e): void => {
                const interpreter = e.old ?? e.new;
                if (interpreter) {
                    this.didChangeInterpreterInformation.fire(interpreter);
                    for (const { path, workspaceFolder } of this.activeInterpreterPaths.values()) {
                        if (path === interpreter.path && !e.new) {
                            // --- Start Positron ---
                            // Active env was deleted externally. Storage-only fire - do not start
                            // a replacement session.
                            this.fireInterpreterChanged(workspaceFolder?.uri, false, 'active-env-deleted');
                            // --- End Positron ---
                            reportActiveInterpreterChanged({
                                path,
                                resource: workspaceFolder,
                            });
                        }
                    }
                }
            }),
        );
        disposables.push(
            documentManager.onDidOpenTextDocument(() => {
                // To handle scenario when language mode is set to "python"
                filter.interpreterVisibilityEmitter.fire();
            }),
            documentManager.onDidChangeActiveTextEditor((e): void => {
                filter.interpreterVisibilityEmitter.fire();
                if (e && e.document) {
                    this.refresh(e.document.uri);
                }
            }),
        );
        // --- Start Positron ---
        // Thread the full scope (including startSession / source) through to _onConfigChanged so
        // we can classify storage-update vs. user-intent fires at the emit point.
        disposables.push(this.interpreterPathService.onDidChange((scope) => this._onConfigChanged(scope)));
        // Upstream also re-runs _onConfigChanged on every python settings change so that a
        // background auto-selection reaches Pylance. Positron doesn't take it: with no scope,
        // _onConfigChanged defaults to startSession: true, so any python.* setting change
        // could start a console session.
        // disposables.push(this.configService.onDidChange(() => this._onConfigChanged()));
        // --- End Positron ---
    }

    public getInterpreters(resource?: Uri): PythonEnvironment[] {
        return this.pyenvs.getInterpreters(resource);
    }

    public async getAllInterpreters(resource?: Uri): Promise<PythonEnvironment[]> {
        // For backwards compatibility with old Jupyter APIs, ensure a
        // fresh refresh is always triggered when using the API. As it is
        // no longer auto-triggered by the extension.
        this.triggerRefresh(undefined, { ifNotTriggerredAlready: true }).ignoreErrors();
        await this.refreshPromise;
        return this.getInterpreters(resource);
    }

    public dispose(): void {
        this.didChangeInterpreterEmitter.dispose();
        this.didChangeInterpreterInformation.dispose();
    }

    public async getActiveInterpreter(
        resource?: Uri,
        options?: GetActiveInterpreterOptions,
    ): Promise<PythonEnvironment | undefined> {
        if (options?.exactResource && useEnvExtension()) {
            return getActiveInterpreterLegacy(resource, { reportActiveInterpreterChanged: false }).catch((ex) => {
                traceError('Failed to get active interpreter', ex);
                return undefined;
            });
        }

        // --- Start Positron ---
        // Always wait for the real resolution. Upstream returns a last-known or persisted
        // interpreter when resolution takes more than 100ms, and shares one in-flight
        // resolution per workspace. Positron starts console sessions from this result
        // (see onDidChangeInterpreter in positron/manager.ts), so a stale value would start
        // the wrong interpreter.
        return this.resolveActiveInterpreter(resource);
        // const workspaceService = this.serviceContainer.get<IWorkspaceService>(IWorkspaceService);
        // const key = workspaceService.getWorkspaceFolderIdentifier(resource);
        //
        // // De-duplicate concurrent resolutions for the same workspace.
        // let resolution = this.inFlightActiveInterpreter.get(key);
        // if (!resolution) {
        //     resolution = this.resolveActiveInterpreter(resource)
        //         .then((env) => {
        //             this.lastKnownActiveInterpreter.set(key, { resource, env });
        //             if (env) {
        //                 // Persist the resolved interpreter so a future window/session can serve a
        //                 // real value within the timeout budget before discovery/refresh completes.
        //                 this.getPersistedActiveInterpreterState(key)
        //                     .updateValue(env)
        //                     .catch((ex) => traceError('Failed to persist active interpreter', ex));
        //             }
        //             return env;
        //         })
        //         .catch((ex) => {
        //             traceError('Failed to get active interpreter', ex);
        //             return undefined;
        //         })
        //         .finally(() => {
        //             this.inFlightActiveInterpreter.delete(key);
        //         });
        //     this.inFlightActiveInterpreter.set(key, resolution);
        // }
        //
        // // Don't block callers (notably language server startup) on a potentially slow
        // // environment discovery/refresh. If resolution doesn't complete promptly, return the
        // // last-known interpreter (or undefined on a cold start). The resolution promise is not
        // // abandoned, so listeners are still notified of the real value once it becomes available:
        // // the env-extension path reports via the environments API (see getActiveInterpreterLegacy),
        // // and the native path reports via `_onConfigChanged` once auto-selection completes.
        // const result = await Promise.race([
        //     resolution,
        //     sleep(GET_ACTIVE_INTERPRETER_TIMEOUT_MS).then(() => ACTIVE_INTERPRETER_TIMED_OUT),
        // ]);
        // if (result !== ACTIVE_INTERPRETER_TIMED_OUT) {
        //     return result as StoredPythonEnvironment | undefined;
        // }
        // // Prefer the value resolved earlier this session; otherwise fall back to the persisted
        // // value from a previous session so warm restarts still serve a real interpreter quickly.
        // const cached = this.lastKnownActiveInterpreter.get(key);
        // if (cached) {
        //     return cached.env;
        // }
        // return this.getPersistedActiveInterpreterState(key).value;
        // --- End Positron ---
    }

    // --- Start Positron ---
    // Unused because getActiveInterpreter doesn't fall back to a persisted interpreter.
    // private getPersistedActiveInterpreterState(key: string): IPersistentState<StoredPythonEnvironment | undefined> {
    //     let state = this.persistedActiveInterpreter.get(key);
    //     if (!state) {
    //         const factory = this.serviceContainer.get<IPersistentStateFactory>(IPersistentStateFactory);
    //         state = factory.createWorkspacePersistentState<StoredPythonEnvironment | undefined>(
    //             `${LAST_KNOWN_ACTIVE_INTERPRETER_KEY_PREFIX}${key}`,
    //             undefined,
    //         );
    //         this.persistedActiveInterpreter.set(key, state);
    //     }
    //     return state;
    // }
    // --- End Positron ---

    private async resolveActiveInterpreter(resource?: Uri): Promise<StoredPythonEnvironment | undefined> {
        if (useEnvExtension()) {
            return getActiveInterpreterLegacy(resource);
        }

        const activatedEnvLaunch = this.serviceContainer.get<IActivatedEnvironmentLaunch>(IActivatedEnvironmentLaunch);
        let path = await activatedEnvLaunch.selectIfLaunchedViaActivatedEnv(true);
        // This is being set as interpreter in background, after which it'll show up in `.pythonPath` config.
        // However we need not wait on the update to take place, as we can use the value directly.
        if (!path) {
            path = this.configService.getSettings(resource).pythonPath;
            if (pathUtils.basename(path) === path) {
                // Value can be `python`, `python3`, `python3.9` etc.
                // Note the following triggers autoselection if no interpreter is explictly
                // selected, i.e the value is `python`.
                // During shutdown we might not be able to get items out of the service container.
                const pythonExecutionFactory =
                    this.serviceContainer.tryGet<IPythonExecutionFactory>(IPythonExecutionFactory);
                const pythonExecutionService = pythonExecutionFactory
                    ? await pythonExecutionFactory.create({ resource })
                    : undefined;
                const fullyQualifiedPath = pythonExecutionService
                    ? await pythonExecutionService.getExecutablePath().catch((ex) => {
                          traceError(ex);
                      })
                    : undefined;
                // Python path is invalid or python isn't installed.
                if (!fullyQualifiedPath) {
                    return undefined;
                }
                path = fullyQualifiedPath;
            }
        }
        return this.getInterpreterDetails(path);
    }

    public async getInterpreterDetails(pythonPath: string): Promise<StoredPythonEnvironment | undefined> {
        return this.pyenvs.getInterpreterDetails(pythonPath);
    }

    // --- Start Positron ---
    // public async _onConfigChanged(resource?: Uri): Promise<void> {
    //
    // Accept an InterpreterConfigurationScope (or bare Uri for backwards-compatible test calls) so
    // we can thread startSession / source through to listeners. Unit tests pass a bare Uri.
    public async _onConfigChanged(scopeOrUri?: InterpreterConfigurationScope | Uri): Promise<void> {
        const scope: InterpreterConfigurationScope =
            scopeOrUri && 'configTarget' in scopeOrUri
                ? scopeOrUri
                : { uri: scopeOrUri, configTarget: undefined as never };
        const resource = scope.uri;
        // --- End Positron ---
        // Check if we actually changed our python path.
        // Config service also updates itself on interpreter config change,
        // so yielding control here to make sure it goes first and updates
        // itself before we can query it.
        await sleep(1);
        const pySettings = this.configService.getSettings(resource);
        this.didChangeInterpreterConfigurationEmitter.fire(resource);
        // --- Start Positron ---
        const workspaceKey = this.serviceContainer
            .get<IWorkspaceService>(IWorkspaceService)
            .getWorkspaceFolderIdentifier(resource);
        const previousPath = this._pythonPathSetting.get(workspaceKey);
        if (previousPath === undefined || previousPath !== pySettings.pythonPath) {
            this._pythonPathSetting.set(workspaceKey, pySettings.pythonPath);
            this.fireInterpreterChanged(resource, scope.startSession ?? true, scope.source ?? 'unspecified');
            // --- End Positron ---
            const workspaceFolder = this.serviceContainer
                .get<IWorkspaceService>(IWorkspaceService)
                .getWorkspaceFolder(resource);
            reportActiveInterpreterChanged({
                path: pySettings.pythonPath,
                resource: workspaceFolder,
            });
            // --- Start Positron ---
            // moved this up
            // const workspaceKey = this.serviceContainer
            //     .get<IWorkspaceService>(IWorkspaceService)
            //     .getWorkspaceFolderIdentifier(resource);
            // --- End Positron ---
            this.activeInterpreterPaths.set(workspaceKey, { path: pySettings.pythonPath, workspaceFolder });
            const interpreterDisplay = this.serviceContainer.get<IInterpreterDisplay>(IInterpreterDisplay);
            interpreterDisplay.refresh().catch((ex) => traceError('Python Extension: display.refresh', ex));
            // --- Start Positron ---
            // await this.ensureEnvironmentContainsPython(this._pythonPathSetting, workspaceFolder);
            await this.ensureEnvironmentContainsPython(pySettings.pythonPath, workspaceFolder);
            // --- End Positron ---
        }
    }

    // --- Start Positron ---
    /**
     * Fire {@link didChangeInterpreterEmitter} with a classified payload. Tracing helps future
     * regressions surface in positron-python logs without extra instrumentation.
     */
    private fireInterpreterChanged(resource: Uri | undefined, startSession: boolean, source: string): void {
        traceInfo(
            `onDidChangeInterpreter: source=${source}, startSession=${startSession}, resource=${
                resource?.fsPath ?? 'undefined'
            }`,
        );
        this.didChangeInterpreterEmitter.fire({ resource, startSession, source });
    }
    // --- End Positron ---

    @cache(-1, true)
    private async ensureEnvironmentContainsPython(pythonPath: string, workspaceFolder: WorkspaceFolder | undefined) {
        if (useEnvExtension()) {
            return;
        }

        const installer = this.serviceContainer.get<IInstaller>(IInstaller);
        if (!(await installer.isInstalled(Product.python))) {
            // If Python is not installed into the environment, install it.
            sendTelemetryEvent(EventName.ENVIRONMENT_WITHOUT_PYTHON_SELECTED);
            const shell = this.serviceContainer.get<IApplicationShell>(IApplicationShell);
            const progressOptions: ProgressOptions = {
                location: ProgressLocation.Window,
                title: `[${Interpreters.installingPython}](command:${Commands.ViewOutput})`,
            };
            traceLog('Conda envs without Python are known to not work well; fixing conda environment...');
            const promise = installer.install(Product.python, await this.getInterpreterDetails(pythonPath));
            shell.withProgress(progressOptions, () => promise);
            promise
                .then(async () => {
                    // Fetch interpreter details so the cache is updated to include the newly installed Python.
                    await this.getInterpreterDetails(pythonPath);
                    // --- Start Positron ---
                    // Storage-only fire. By the time this lands, the session has already been
                    // requested via the caller that triggered the install (quickpick -> update() ->
                    // _onConfigChanged).
                    this.fireInterpreterChanged(workspaceFolder?.uri, false, 'install-complete');
                    // --- End Positron ---
                    reportActiveInterpreterChanged({
                        path: pythonPath,
                        resource: workspaceFolder,
                    });
                })
                .ignoreErrors();
        }
    }
}
