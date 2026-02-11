import { EventEmitter, MarkdownString, ProgressLocation, Uri } from 'vscode';
import {
    DidChangeEnvironmentEventArgs,
    DidChangeEnvironmentsEventArgs,
    EnvironmentChangeKind,
    EnvironmentManager,
    GetEnvironmentScope,
    GetEnvironmentsScope,
    IconPath,
    PythonEnvironment,
    PythonEnvironmentApi,
    PythonProject,
    RefreshEnvironmentsScope,
    ResolveEnvironmentContext,
    SetEnvironmentScope,
} from '../../api';
import { PipenvStrings } from '../../common/localize';
import { createDeferred, Deferred } from '../../common/utils/deferred';
import { withProgress } from '../../common/window.apis';
import { NativePythonFinder } from '../common/nativePythonFinder';
import {
    clearPipenvCache,
    getPipenvForGlobal,
    getPipenvForWorkspace,
    refreshPipenv,
    resolvePipenvPath,
    setPipenvForGlobal,
    setPipenvForWorkspace,
    setPipenvForWorkspaces,
} from './pipenvUtils';

export class PipenvManager implements EnvironmentManager {
    private collection: PythonEnvironment[] = [];
    private fsPathToEnv: Map<string, PythonEnvironment> = new Map();
    private globalEnv: PythonEnvironment | undefined;

    private readonly _onDidChangeEnvironment = new EventEmitter<DidChangeEnvironmentEventArgs>();
    public readonly onDidChangeEnvironment = this._onDidChangeEnvironment.event;

    private readonly _onDidChangeEnvironments = new EventEmitter<DidChangeEnvironmentsEventArgs>();
    public readonly onDidChangeEnvironments = this._onDidChangeEnvironments.event;

    public readonly name: string;
    public readonly displayName: string;
    public readonly preferredPackageManagerId: string;
    public readonly description?: string;
    public readonly tooltip: string | MarkdownString;
    public readonly iconPath?: IconPath;

    private _initialized: Deferred<void> | undefined;

    constructor(public readonly nativeFinder: NativePythonFinder, public readonly api: PythonEnvironmentApi) {
        this.name = 'pipenv';
        this.displayName = 'Pipenv';
        this.preferredPackageManagerId = 'ms-python.python:pip';
        this.tooltip = new MarkdownString(PipenvStrings.pipenvManager, true);
    }

    public dispose() {
        this.collection = [];
        this.fsPathToEnv.clear();
        this._onDidChangeEnvironment.dispose();
        this._onDidChangeEnvironments.dispose();
    }

    async initialize(): Promise<void> {
        if (this._initialized) {
            return this._initialized.promise;
        }

        this._initialized = createDeferred();

        await withProgress(
            {
                location: ProgressLocation.Window,
                title: PipenvStrings.pipenvDiscovering,
            },
            async () => {
                this.collection = await refreshPipenv(false, this.nativeFinder, this.api, this);
                await this.loadEnvMap();

                this._onDidChangeEnvironments.fire(
                    this.collection.map((e) => ({ environment: e, kind: EnvironmentChangeKind.add })),
                );
            },
        );
        this._initialized.resolve();
    }

    private async loadEnvMap() {
        // Load environment mappings for projects
        const projects = this.api.getPythonProjects();
        for (const project of projects) {
            const envPath = await getPipenvForWorkspace(project.uri.fsPath);
            if (envPath) {
                const env = this.findEnvironmentByPath(envPath);
                if (env) {
                    this.fsPathToEnv.set(project.uri.fsPath, env);
                }
            }
        }

        // Load global environment
        const globalEnvPath = await getPipenvForGlobal();
        if (globalEnvPath) {
            this.globalEnv = this.findEnvironmentByPath(globalEnvPath);
        }
    }

    private findEnvironmentByPath(fsPath: string): PythonEnvironment | undefined {
        return this.collection.find(
            (env) => env.environmentPath.fsPath === fsPath || env.execInfo?.run.executable === fsPath,
        );
    }

    async refresh(scope: RefreshEnvironmentsScope): Promise<void> {
        const hardRefresh = scope === undefined; // hard refresh when scope is undefined

        await withProgress(
            {
                location: ProgressLocation.Window,
                title: PipenvStrings.pipenvRefreshing,
            },
            async () => {
                const oldCollection = [...this.collection];
                this.collection = await refreshPipenv(hardRefresh, this.nativeFinder, this.api, this);
                await this.loadEnvMap();

                // Fire change events for environments that were added or removed
                const changes: { environment: PythonEnvironment; kind: EnvironmentChangeKind }[] = [];

                // Find removed environments
                oldCollection.forEach((oldEnv) => {
                    if (!this.collection.find((newEnv) => newEnv.envId.id === oldEnv.envId.id)) {
                        changes.push({ environment: oldEnv, kind: EnvironmentChangeKind.remove });
                    }
                });

                // Find added environments
                this.collection.forEach((newEnv) => {
                    if (!oldCollection.find((oldEnv) => oldEnv.envId.id === newEnv.envId.id)) {
                        changes.push({ environment: newEnv, kind: EnvironmentChangeKind.add });
                    }
                });

                if (changes.length > 0) {
                    this._onDidChangeEnvironments.fire(changes);
                }
            },
        );
    }

    async getEnvironments(scope: GetEnvironmentsScope): Promise<PythonEnvironment[]> {
        await this.initialize();

        if (scope === 'all') {
            return Array.from(this.collection);
        }

        if (scope === 'global') {
            // Return all environments for global scope
            return Array.from(this.collection);
        }

        if (scope instanceof Uri) {
            const project = this.api.getPythonProject(scope);
            if (project) {
                const env = this.fsPathToEnv.get(project.uri.fsPath);
                return env ? [env] : [];
            }
        }

        return [];
    }

    async set(scope: SetEnvironmentScope, environment?: PythonEnvironment): Promise<void> {
        if (scope === undefined) {
            // Global scope
            const before = this.globalEnv;
            this.globalEnv = environment;
            await setPipenvForGlobal(environment?.environmentPath.fsPath);

            if (before?.envId.id !== this.globalEnv?.envId.id) {
                this._onDidChangeEnvironment.fire({ uri: undefined, old: before, new: this.globalEnv });
            }
            return;
        }

        if (scope instanceof Uri) {
            // Single project scope
            const project = this.api.getPythonProject(scope);
            if (!project) {
                return;
            }

            const before = this.fsPathToEnv.get(project.uri.fsPath);
            if (environment) {
                this.fsPathToEnv.set(project.uri.fsPath, environment);
            } else {
                this.fsPathToEnv.delete(project.uri.fsPath);
            }

            await setPipenvForWorkspace(project.uri.fsPath, environment?.environmentPath.fsPath);

            if (before?.envId.id !== environment?.envId.id) {
                this._onDidChangeEnvironment.fire({ uri: scope, old: before, new: environment });
            }
        }

        if (Array.isArray(scope) && scope.every((u) => u instanceof Uri)) {
            // Multiple projects scope
            const projects: PythonProject[] = [];
            scope
                .map((s) => this.api.getPythonProject(s))
                .forEach((p) => {
                    if (p) {
                        projects.push(p);
                    }
                });

            const before: Map<string, PythonEnvironment | undefined> = new Map();
            projects.forEach((p) => {
                before.set(p.uri.fsPath, this.fsPathToEnv.get(p.uri.fsPath));
                if (environment) {
                    this.fsPathToEnv.set(p.uri.fsPath, environment);
                } else {
                    this.fsPathToEnv.delete(p.uri.fsPath);
                }
            });

            await setPipenvForWorkspaces(
                projects.map((p) => p.uri.fsPath),
                environment?.environmentPath.fsPath,
            );

            projects.forEach((p) => {
                const b = before.get(p.uri.fsPath);
                if (b?.envId.id !== environment?.envId.id) {
                    this._onDidChangeEnvironment.fire({ uri: p.uri, old: b, new: environment });
                }
            });
        }
    }

    async get(scope: GetEnvironmentScope): Promise<PythonEnvironment | undefined> {
        await this.initialize();

        if (scope === undefined) {
            return this.globalEnv;
        }

        if (scope instanceof Uri) {
            const project = this.api.getPythonProject(scope);
            if (project) {
                return this.fsPathToEnv.get(project.uri.fsPath);
            }
        }

        return undefined;
    }

    async resolve(context: ResolveEnvironmentContext): Promise<PythonEnvironment | undefined> {
        await this.initialize();
        return resolvePipenvPath(context.fsPath, this.nativeFinder, this.api, this);
    }

    async clearCache?(): Promise<void> {
        await clearPipenvCache();
        this.collection = [];
        this.fsPathToEnv.clear();
        this.globalEnv = undefined;
        this._initialized = undefined;
    }
}
