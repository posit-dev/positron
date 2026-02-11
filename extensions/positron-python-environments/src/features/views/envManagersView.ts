import { Disposable, Event, EventEmitter, ProviderResult, TreeDataProvider, TreeItem, TreeView, window } from 'vscode';
import { DidChangeEnvironmentEventArgs, EnvironmentGroupInfo, PythonEnvironment } from '../../api';
import { ProjectViews } from '../../common/localize';
import { createSimpleDebounce } from '../../common/utils/debounce';
import {
    DidChangeEnvironmentManagerEventArgs,
    DidChangePackageManagerEventArgs,
    EnvironmentManagers,
    InternalDidChangeEnvironmentsEventArgs,
    InternalDidChangePackagesEventArgs,
    InternalEnvironmentManager,
    InternalPackageManager,
} from '../../internal.api';
import { ITemporaryStateManager } from './temporaryStateManager';
import {
    EnvInfoTreeItem,
    EnvManagerTreeItem,
    EnvTreeItem,
    EnvTreeItemKind,
    NoPythonEnvTreeItem,
    PackageTreeItem,
    PythonEnvTreeItem,
    PythonGroupEnvTreeItem,
} from './treeViewItems';

const COPIED_STATE = 'copied';
const SELECTED_STATE = 'selected';
const ENV_STATE_KEYS = [COPIED_STATE, SELECTED_STATE];

export class EnvManagerView implements TreeDataProvider<EnvTreeItem>, Disposable {
    private treeView: TreeView<EnvTreeItem>;
    private treeDataChanged: EventEmitter<EnvTreeItem | EnvTreeItem[] | null | undefined> = new EventEmitter<
        EnvTreeItem | EnvTreeItem[] | null | undefined
    >();
    private revealMap = new Map<string, PythonEnvTreeItem>();
    private managerViews = new Map<string, EnvManagerTreeItem>();
    private selected: Map<string, string> = new Map();
    private disposables: Disposable[] = [];

    public constructor(public providers: EnvironmentManagers, private stateManager: ITemporaryStateManager) {
        this.treeView = window.createTreeView<EnvTreeItem>('env-managers', {
            treeDataProvider: this,
        });

        this.disposables.push(
            new Disposable(() => {
                this.revealMap.clear();
                this.managerViews.clear();
                this.selected.clear();
            }),
            this.treeView,
            this.treeDataChanged,
            this.providers.onDidChangeEnvironments((e: InternalDidChangeEnvironmentsEventArgs) => {
                this.onDidChangeEnvironments(e);
            }),
            this.providers.onDidChangeEnvironmentManager((m: DidChangeEnvironmentManagerEventArgs) => {
                this.onDidChangeEnvironmentManager(m);
            }),

            this.providers.onDidChangePackages((p: InternalDidChangePackagesEventArgs) => {
                this.onDidChangePackages(p);
            }),
            this.providers.onDidChangePackageManager((p: DidChangePackageManagerEventArgs) => {
                this.onDidChangePackageManager(p);
            }),
        );

        this.disposables.push(
            this.stateManager.onDidChangeState(({ itemId }) => {
                const view = this.revealMap.get(itemId);
                if (view) {
                    this.fireDataChanged(view);
                }
            }),
        );
    }

    dispose() {
        this.disposables.forEach((d) => d.dispose());
    }

    private debouncedFireDataChanged = createSimpleDebounce(500, () => this.treeDataChanged.fire(undefined));
    private fireDataChanged(item: EnvTreeItem | EnvTreeItem[] | null | undefined) {
        if (item) {
            this.treeDataChanged.fire(item);
        } else {
            this.debouncedFireDataChanged.trigger();
        }
    }

    onDidChangeTreeData: Event<void | EnvTreeItem | EnvTreeItem[] | null | undefined> = this.treeDataChanged.event;

    getTreeItem(element: EnvTreeItem): TreeItem | Thenable<TreeItem> {
        if (element.kind === EnvTreeItemKind.environment && element instanceof PythonEnvTreeItem) {
            const itemId = element.environment.envId.id;
            const currentContext = element.treeItem.contextValue ?? '';
            element.treeItem.contextValue = this.stateManager.updateContextValue(
                itemId,
                currentContext,
                ENV_STATE_KEYS,
            );
        }
        return element.treeItem;
    }

    async getChildren(element?: EnvTreeItem | undefined): Promise<EnvTreeItem[] | undefined> {
        if (!element) {
            const views: EnvTreeItem[] = [];
            this.managerViews.clear();
            this.providers.managers.forEach((m) => {
                const view = new EnvManagerTreeItem(m);
                views.push(view);
                this.managerViews.set(m.id, view);
            });
            return views;
        }

        if (element.kind === EnvTreeItemKind.manager) {
            const manager = (element as EnvManagerTreeItem).manager;
            const views: EnvTreeItem[] = [];
            const envs = await manager.getEnvironments('all');
            envs.filter((e) => !e.group).forEach((env) => {
                const view = new PythonEnvTreeItem(env, element as EnvManagerTreeItem, this.selected.get(env.envId.id));
                views.push(view);
                this.revealMap.set(env.envId.id, view);
            });

            const groups: string[] = [];
            const groupObjects: (string | EnvironmentGroupInfo)[] = [];
            envs.filter((e) => e.group).forEach((env) => {
                const name =
                    env.group && typeof env.group === 'string' ? env.group : (env.group as EnvironmentGroupInfo).name;
                if (name && !groups.includes(name)) {
                    groups.push(name);
                    groupObjects.push(env.group as EnvironmentGroupInfo);
                }
            });

            groupObjects.forEach((group) => {
                views.push(new PythonGroupEnvTreeItem(element as EnvManagerTreeItem, group));
            });

            if (views.length === 0) {
                views.push(new NoPythonEnvTreeItem(element as EnvManagerTreeItem));
            }
            return views;
        }

        if (element.kind === EnvTreeItemKind.environmentGroup) {
            const groupItem = element as PythonGroupEnvTreeItem;
            const manager = groupItem.parent.manager;
            const views: EnvTreeItem[] = [];
            const envs = await manager.getEnvironments('all');
            const groupName =
                typeof groupItem.group === 'string' ? groupItem.group : (groupItem.group as EnvironmentGroupInfo).name;
            const grouped = envs.filter((e) => {
                if (e.group) {
                    const name =
                        e.group && typeof e.group === 'string' ? e.group : (e.group as EnvironmentGroupInfo).name;
                    return name === groupName;
                }
                return false;
            });

            grouped.forEach((env) => {
                const view = new PythonEnvTreeItem(env, groupItem, this.selected.get(env.envId.id));
                views.push(view);
                this.revealMap.set(env.envId.id, view);
            });

            return views;
        }

        if (element.kind === EnvTreeItemKind.environment) {
            const pythonEnvItem = element as PythonEnvTreeItem;
            const environment = pythonEnvItem.environment;
            const envManager =
                pythonEnvItem.parent.kind === EnvTreeItemKind.environmentGroup
                    ? pythonEnvItem.parent.parent.manager
                    : pythonEnvItem.parent.manager;

            const pkgManager = this.getSupportedPackageManager(envManager);
            const parent = element as PythonEnvTreeItem;
            const views: EnvTreeItem[] = [];

            if (pkgManager) {
                const packages = await pkgManager.getPackages(environment);
                if (packages && packages.length > 0) {
                    views.push(...packages.map((p) => new PackageTreeItem(p, parent, pkgManager)));
                } else {
                    views.push(new EnvInfoTreeItem(parent, ProjectViews.noPackages));
                }
            } else {
                views.push(new EnvInfoTreeItem(parent, ProjectViews.noPackageManager));
            }

            return views;
        }
    }

    getParent(element: EnvTreeItem): ProviderResult<EnvTreeItem> {
        return element.parent;
    }

    reveal(environment?: PythonEnvironment) {
        const view = environment ? this.revealMap.get(environment.envId.id) : undefined;
        if (view && this.treeView.visible) {
            setImmediate(async () => {
                await this.treeView.reveal(view);
            });
        }
    }

    private getSupportedPackageManager(manager: InternalEnvironmentManager): InternalPackageManager | undefined {
        return this.providers.getPackageManager(manager.preferredPackageManagerId);
    }

    private onDidChangeEnvironmentManager(_args: DidChangeEnvironmentManagerEventArgs) {
        this.fireDataChanged(undefined);
    }

    private onDidChangeEnvironments(args: InternalDidChangeEnvironmentsEventArgs) {
        this.fireDataChanged(this.managerViews.get(args.manager.id));
    }

    private onDidChangePackages(args: InternalDidChangePackagesEventArgs) {
        const view = Array.from(this.revealMap.values()).find(
            (v) => v.environment.envId.id === args.environment.envId.id,
        );
        if (view) {
            this.fireDataChanged(view);
        }
    }

    private onDidChangePackageManager(_args: DidChangePackageManagerEventArgs) {
        // Since we removed the packageRoots level, just refresh all environments
        // This is a simplified approach that isn't as targeted but ensures packages get refreshed
        this.fireDataChanged(undefined);
    }

    public environmentChanged(e: DidChangeEnvironmentEventArgs) {
        const views = [];
        if (e.old) {
            this.selected.delete(e.old.envId.id);
            const view: EnvTreeItem | undefined = this.revealMap.get(e.old.envId.id);
            if (view) {
                views.push(view);
            }
        }
        if (e.new) {
            this.selected.set(e.new.envId.id, e.uri === undefined ? 'global' : e.uri.fsPath);
            const view: EnvTreeItem | undefined = this.revealMap.get(e.new.envId.id);
            if (view && !views.includes(view)) {
                views.push(view);
            }
        }
        this.fireDataChanged(views);
    }
}
