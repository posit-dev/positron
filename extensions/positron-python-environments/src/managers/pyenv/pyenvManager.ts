import * as path from 'path';
import { Disposable, EventEmitter, MarkdownString, ProgressLocation, Uri } from 'vscode';
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
import { PyenvStrings } from '../../common/localize';
import { traceError, traceInfo } from '../../common/logging';
import { createDeferred, Deferred } from '../../common/utils/deferred';
import { withProgress } from '../../common/window.apis';
import { NativePythonFinder } from '../common/nativePythonFinder';
import { getLatest } from '../common/utils';
import {
    clearPyenvCache,
    getPyenvForGlobal,
    getPyenvForWorkspace,
    PYENV_VERSIONS,
    refreshPyenv,
    resolvePyenvPath,
    setPyenvForGlobal,
    setPyenvForWorkspace,
    setPyenvForWorkspaces,
} from './pyenvUtils';

export class PyEnvManager implements EnvironmentManager, Disposable {
    private collection: PythonEnvironment[] = [];
    private fsPathToEnv: Map<string, PythonEnvironment> = new Map();
    private globalEnv: PythonEnvironment | undefined;

    private readonly _onDidChangeEnvironment = new EventEmitter<DidChangeEnvironmentEventArgs>();
    public readonly onDidChangeEnvironment = this._onDidChangeEnvironment.event;

    private readonly _onDidChangeEnvironments = new EventEmitter<DidChangeEnvironmentsEventArgs>();
    public readonly onDidChangeEnvironments = this._onDidChangeEnvironments.event;

    constructor(private readonly nativeFinder: NativePythonFinder, private readonly api: PythonEnvironmentApi) {
        this.name = 'pyenv';
        this.displayName = 'PyEnv';
        this.preferredPackageManagerId = 'ms-python.python:pip';
        this.tooltip = new MarkdownString(PyenvStrings.pyenvManager, true);
    }

    name: string;
    displayName: string;
    preferredPackageManagerId: string;
    description?: string;
    tooltip: string | MarkdownString;
    iconPath?: IconPath;

    public dispose() {
        this.collection = [];
        this.fsPathToEnv.clear();
    }

    private _initialized: Deferred<void> | undefined;
    async initialize(): Promise<void> {
        if (this._initialized) {
            return this._initialized.promise;
        }

        this._initialized = createDeferred();

        await withProgress(
            {
                location: ProgressLocation.Window,
                title: PyenvStrings.pyenvDiscovering,
            },
            async () => {
                this.collection = await refreshPyenv(false, this.nativeFinder, this.api, this);
                await this.loadEnvMap();

                this._onDidChangeEnvironments.fire(
                    this.collection.map((e) => ({ environment: e, kind: EnvironmentChangeKind.add })),
                );
            },
        );
        this._initialized.resolve();
    }

    async getEnvironments(scope: GetEnvironmentsScope): Promise<PythonEnvironment[]> {
        await this.initialize();

        if (scope === 'all') {
            return Array.from(this.collection);
        }

        if (scope === 'global') {
            return this.collection.filter((env) => {
                env.group === PYENV_VERSIONS;
            });
        }

        if (scope instanceof Uri) {
            const env = this.fromEnvMap(scope);
            if (env) {
                return [env];
            }
        }

        return [];
    }

    async refresh(context: RefreshEnvironmentsScope): Promise<void> {
        if (context === undefined) {
            await withProgress(
                {
                    location: ProgressLocation.Window,
                    title: PyenvStrings.pyenvRefreshing,
                },
                async () => {
                    traceInfo('Refreshing Pyenv Environments');
                    const discard = this.collection.map((c) => c);
                    this.collection = await refreshPyenv(true, this.nativeFinder, this.api, this);

                    await this.loadEnvMap();

                    const args = [
                        ...discard.map((env) => ({ kind: EnvironmentChangeKind.remove, environment: env })),
                        ...this.collection.map((env) => ({ kind: EnvironmentChangeKind.add, environment: env })),
                    ];

                    this._onDidChangeEnvironments.fire(args);
                },
            );
        }
    }

    async get(scope: GetEnvironmentScope): Promise<PythonEnvironment | undefined> {
        await this.initialize();
        if (scope instanceof Uri) {
            let env = this.fsPathToEnv.get(scope.fsPath);
            if (env) {
                return env;
            }
            const project = this.api.getPythonProject(scope);
            if (project) {
                env = this.fsPathToEnv.get(project.uri.fsPath);
                if (env) {
                    return env;
                }
            }
        }

        return this.globalEnv;
    }
    async set(scope: SetEnvironmentScope, environment?: PythonEnvironment | undefined): Promise<void> {
        if (scope === undefined) {
            await setPyenvForGlobal(environment?.environmentPath?.fsPath);
        } else if (scope instanceof Uri) {
            const folder = this.api.getPythonProject(scope);
            const fsPath = folder?.uri?.fsPath ?? scope.fsPath;
            if (fsPath) {
                if (environment) {
                    this.fsPathToEnv.set(fsPath, environment);
                } else {
                    this.fsPathToEnv.delete(fsPath);
                }
                await setPyenvForWorkspace(fsPath, environment?.environmentPath?.fsPath);
            }
        } else if (Array.isArray(scope) && scope.every((u) => u instanceof Uri)) {
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

            await setPyenvForWorkspaces(
                projects.map((p) => p.uri.fsPath),
                environment?.environmentPath?.fsPath,
            );

            projects.forEach((p) => {
                const b = before.get(p.uri.fsPath);
                if (b?.envId.id !== environment?.envId.id) {
                    this._onDidChangeEnvironment.fire({ uri: p.uri, old: b, new: environment });
                }
            });
        }
    }

    async resolve(context: ResolveEnvironmentContext): Promise<PythonEnvironment | undefined> {
        await this.initialize();

        if (context instanceof Uri) {
            const env = await resolvePyenvPath(context.fsPath, this.nativeFinder, this.api, this);
            if (env) {
                const _collectionEnv = this.findEnvironmentByPath(env.environmentPath.fsPath);
                if (_collectionEnv) {
                    return _collectionEnv;
                }

                this.collection.push(env);
                this._onDidChangeEnvironments.fire([{ kind: EnvironmentChangeKind.add, environment: env }]);

                return env;
            }

            return undefined;
        }
    }

    async clearCache(): Promise<void> {
        await clearPyenvCache();
    }

    private async loadEnvMap() {
        this.globalEnv = undefined;
        this.fsPathToEnv.clear();

        // Try to find a global environment
        const fsPath = await getPyenvForGlobal();

        if (fsPath) {
            this.globalEnv = this.findEnvironmentByPath(fsPath);

            // If the environment is not found, resolve the fsPath. Could be portable conda.
            if (!this.globalEnv) {
                this.globalEnv = await resolvePyenvPath(fsPath, this.nativeFinder, this.api, this);

                // If the environment is resolved, add it to the collection
                if (this.globalEnv) {
                    this.collection.push(this.globalEnv);
                }
            }
        }

        if (!this.globalEnv) {
            this.globalEnv = getLatest(this.collection.filter((e) => e.group === PYENV_VERSIONS));
        }

        // Find any pyenv environments that might be associated with the current projects
        // These are environments whose parent dirs are project dirs.
        const pathSorted = this.collection
            .filter((e) => this.api.getPythonProject(e.environmentPath))
            .sort((a, b) => {
                if (a.environmentPath.fsPath !== b.environmentPath.fsPath) {
                    return a.environmentPath.fsPath.length - b.environmentPath.fsPath.length;
                }
                return a.environmentPath.fsPath.localeCompare(b.environmentPath.fsPath);
            });

        // Try to find workspace environments
        const paths = this.api.getPythonProjects().map((p) => p.uri.fsPath);
        for (const p of paths) {
            const env = await getPyenvForWorkspace(p);

            if (env) {
                const found = this.findEnvironmentByPath(env);

                if (found) {
                    this.fsPathToEnv.set(p, found);
                } else {
                    // If not found, resolve the pyenv path. Could be portable pyenv.
                    const resolved = await resolvePyenvPath(env, this.nativeFinder, this.api, this);

                    if (resolved) {
                        // If resolved add it to the collection
                        this.fsPathToEnv.set(p, resolved);
                        this.collection.push(resolved);
                    } else {
                        traceError(`Failed to resolve pyenv environment: ${env}`);
                    }
                }
            } else {
                // If there is not an environment already assigned by user to this project
                // then see if there is one in the collection
                if (pathSorted.length === 1) {
                    this.fsPathToEnv.set(p, pathSorted[0]);
                } else {
                    // If there is more than one environment then we need to check if the project
                    // is a subfolder of one of the environments
                    const found = pathSorted.find((e) => {
                        const t = this.api.getPythonProject(e.environmentPath)?.uri.fsPath;
                        return t && path.normalize(t) === p;
                    });
                    if (found) {
                        this.fsPathToEnv.set(p, found);
                    }
                }
            }
        }
    }

    private fromEnvMap(uri: Uri): PythonEnvironment | undefined {
        // Find environment directly using the URI mapping
        const env = this.fsPathToEnv.get(uri.fsPath);
        if (env) {
            return env;
        }

        // Find environment using the Python project for the Uri
        const project = this.api.getPythonProject(uri);
        if (project) {
            return this.fsPathToEnv.get(project.uri.fsPath);
        }

        return undefined;
    }

    private findEnvironmentByPath(fsPath: string): PythonEnvironment | undefined {
        const normalized = path.normalize(fsPath);
        return this.collection.find((e) => {
            const n = path.normalize(e.environmentPath.fsPath);
            return n === normalized || path.dirname(n) === normalized || path.dirname(path.dirname(n)) === normalized;
        });
    }
}
