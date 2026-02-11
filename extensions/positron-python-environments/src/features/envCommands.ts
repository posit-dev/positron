import * as fs from 'fs-extra';
import * as path from 'path';
import { commands, QuickInputButtons, TaskExecution, TaskRevealKind, Terminal, Uri, workspace } from 'vscode';
import {
    CreateEnvironmentOptions,
    PythonEnvironment,
    PythonEnvironmentApi,
    PythonProject,
    PythonProjectCreator,
    PythonProjectCreatorOptions,
} from '../api';
import { traceError, traceInfo, traceVerbose } from '../common/logging';
import {
    EnvironmentManagers,
    InternalEnvironmentManager,
    InternalPackageManager,
    ProjectCreators,
    PythonProjectManager,
} from '../internal.api';
import { removePythonProjectSetting, setEnvironmentManager, setPackageManager } from './settings/settingHelpers';

import { clipboardWriteText } from '../common/env.apis';
import {} from '../common/errors/utils';
import { pickEnvironment } from '../common/pickers/environments';
import {
    pickCreator,
    pickEnvironmentManager,
    pickPackageManager,
    pickWorkspaceFolder,
} from '../common/pickers/managers';
import { pickProject, pickProjectMany } from '../common/pickers/projects';
import { activeTextEditor, showErrorMessage, showInformationMessage } from '../common/window.apis';
import { runAsTask } from './execution/runAsTask';
import { runInTerminal } from './terminal/runInTerminal';
import { TerminalManager } from './terminal/terminalManager';
import {
    EnvManagerTreeItem,
    EnvTreeItemKind,
    GlobalProjectItem,
    PackageTreeItem,
    ProjectEnvironment,
    ProjectItem,
    ProjectPackage,
    PythonEnvTreeItem,
} from './views/treeViewItems';

export async function refreshManagerCommand(context: unknown): Promise<void> {
    if (context instanceof EnvManagerTreeItem) {
        const manager = (context as EnvManagerTreeItem).manager;
        await manager.refresh(undefined);
    } else {
        traceVerbose(`Invalid context for refresh command: ${context}`);
    }
}

export async function refreshPackagesCommand(context: unknown, managers?: EnvironmentManagers): Promise<void> {
    if (context instanceof ProjectEnvironment) {
        const view = context as ProjectEnvironment;
        if (managers) {
            const pkgManager = managers.getPackageManager(view.parent.project.uri);
            if (pkgManager) {
                await pkgManager.refresh(view.environment);
            }
        }
    } else if (context instanceof PythonEnvTreeItem) {
        const view = context as PythonEnvTreeItem;
        const envManager =
            view.parent.kind === EnvTreeItemKind.environmentGroup ? view.parent.parent.manager : view.parent.manager;
        const pkgManager = managers?.getPackageManager(envManager.preferredPackageManagerId);
        if (pkgManager) {
            await pkgManager.refresh(view.environment);
        }
    } else {
        traceVerbose(`Invalid context for refresh command: ${context}`);
    }
}

/**
 * Creates a Python environment using the manager implied by the context (no user prompt).
 */
export async function createEnvironmentCommand(
    context: unknown,
    em: EnvironmentManagers,
    pm: PythonProjectManager,
): Promise<PythonEnvironment | undefined> {
    if (context instanceof EnvManagerTreeItem) {
        const manager = (context as EnvManagerTreeItem).manager;
        const projects = pm.getProjects();
        if (projects.length === 0) {
            const env = await manager.create('global', undefined);
            if (env) {
                await em.setEnvironments('global', env);
            }
            return env;
        } else if (projects.length > 0) {
            const selected = await pickProjectMany(projects);
            if (selected) {
                const scope = selected.length === 0 ? 'global' : selected.map((p) => p.uri);
                const env = await manager.create(scope, undefined);
                if (env) {
                    await em.setEnvironmentsIfUnset(scope, env);
                }
                return env;
            } else {
                traceInfo('No project selected or global condition met for environment creation');
            }
        }
    } else if (context instanceof Uri) {
        const manager = em.getEnvironmentManager(context as Uri);
        const project = pm.get(context as Uri);
        if (project) {
            return await manager?.create(project.uri, undefined);
        } else {
            traceError(`No project found for ${context}`);
        }
    } else {
        traceError(`Invalid context for create command: ${context}`);
    }
}

/**
 * Prompts the user to pick the environment manager and project(s) for environment creation.
 */
export async function createAnyEnvironmentCommand(
    em: EnvironmentManagers,
    pm: PythonProjectManager,
    options?: CreateEnvironmentOptions & {
        selectEnvironment?: boolean;
        showBackButton?: boolean;
        uri?: Uri;
    },
): Promise<PythonEnvironment | undefined> {
    const select = options?.selectEnvironment;
    const projects = pm.getProjects(options?.uri ? [options?.uri] : undefined);
    if (projects.length === 0) {
        const managerId = await pickEnvironmentManager(em.managers.filter((m) => m.supportsCreate));
        const manager = em.managers.find((m) => m.id === managerId);
        if (manager) {
            const env = await manager.create('global', { ...options });
            if (select && env) {
                await manager.set(undefined, env);
            }
            return env;
        }
    } else if (projects.length > 0) {
        const selected = await pickProjectMany(projects, options?.showBackButton);

        if (selected && selected.length > 0) {
            const defaultManagers: InternalEnvironmentManager[] = [];

            selected.forEach((p) => {
                const manager = em.getEnvironmentManager(p.uri);
                if (manager && manager.supportsCreate && !defaultManagers.includes(manager)) {
                    defaultManagers.push(manager);
                }
            });

            let quickCreate = options?.quickCreate ?? false;
            let manager: InternalEnvironmentManager | undefined;

            if (quickCreate && defaultManagers.length === 1) {
                manager = defaultManagers[0];
            } else {
                let managerId = await pickEnvironmentManager(
                    em.managers.filter((m) => m.supportsCreate),
                    defaultManagers,
                    options?.showBackButton,
                );
                if (managerId?.startsWith('QuickCreate#')) {
                    quickCreate = true;
                    managerId = managerId.replace('QuickCreate#', '');
                }

                manager = em.managers.find((m) => m.id === managerId);
            }

            if (manager) {
                const env = await manager.create(
                    selected.map((p) => p.uri),
                    { ...options, quickCreate },
                );
                if (select && env) {
                    await em.setEnvironments(
                        selected.map((p) => p.uri),
                        env,
                    );
                }
                return env;
            }
        }
    }
}

export async function removeEnvironmentCommand(context: unknown, managers: EnvironmentManagers): Promise<void> {
    if (context instanceof PythonEnvTreeItem) {
        const view = context as PythonEnvTreeItem;
        const manager =
            view.parent.kind === EnvTreeItemKind.environmentGroup ? view.parent.parent.manager : view.parent.manager;
        await manager.remove(view.environment);
    } else if (context instanceof Uri) {
        const manager = managers.getEnvironmentManager(context as Uri);
        const environment = await manager?.get(context as Uri);
        if (environment) {
            await manager?.remove(environment);
        }
    } else if (context instanceof ProjectEnvironment) {
        const view = context as ProjectEnvironment;
        const manager = managers.getEnvironmentManager(view.parent.project.uri);
        await manager?.remove(view.environment);
    } else {
        traceError(`Invalid context for remove command: ${context}`);
    }
}

export async function handlePackageUninstall(context: unknown, em: EnvironmentManagers) {
    if (context instanceof PackageTreeItem || context instanceof ProjectPackage) {
        const moduleName = context.pkg.name;
        const environment = context instanceof ProjectPackage ? context.parent.environment : context.parent.environment;
        const packageManager = em.getPackageManager(environment);
        await packageManager?.manage(environment, { uninstall: [moduleName], install: [] });
        return;
    }
    traceError(`Invalid context for uninstall command: ${typeof context}`);
}

export async function setEnvironmentCommand(
    context: unknown,
    em: EnvironmentManagers,
    wm: PythonProjectManager,
): Promise<void> {
    if (context instanceof PythonEnvTreeItem) {
        try {
            const view = context as PythonEnvTreeItem;
            const projects = wm.getProjects();
            if (projects.length > 0) {
                const selected = await pickProjectMany(projects);
                if (selected && selected.length > 0) {
                    // Check if the selected environment is already the current one for each project
                    await setEnvironmentForProjects(selected, context.environment, em);
                }
            } else {
                await em.setEnvironments('global', view.environment);
            }
        } catch (ex) {
            if (ex === QuickInputButtons.Back) {
                await setEnvironmentCommand(context, em, wm);
            }
            throw ex;
        }
    } else if (context instanceof ProjectItem) {
        const view = context as ProjectItem;
        await setEnvironmentCommand([view.project.uri], em, wm);
    } else if (context instanceof GlobalProjectItem) {
        await setEnvironmentCommand(undefined, em, wm);
    } else if (context instanceof Uri) {
        await setEnvironmentCommand([context], em, wm);
    } else if (context === undefined) {
        try {
            const projects = wm.getProjects();
            if (projects.length > 0) {
                const selected = await pickProjectMany(projects);
                if (selected && selected.length > 0) {
                    const uris = selected.map((p) => p.uri);
                    await setEnvironmentCommand(uris, em, wm);
                }
            } else {
                const globalEnvManager = em.getEnvironmentManager(undefined);
                const recommended = globalEnvManager ? await globalEnvManager.get(undefined) : undefined;
                const selected = await pickEnvironment(em.managers, globalEnvManager ? [globalEnvManager] : [], {
                    projects: [],
                    recommended,
                    showBackButton: false,
                });
                if (selected) {
                    await em.setEnvironments('global', selected);
                }
            }
        } catch (ex) {
            if (ex === QuickInputButtons.Back) {
                await setEnvironmentCommand(context, em, wm);
            }
            throw ex;
        }
    } else if (Array.isArray(context) && context.length > 0 && context.every((c) => c instanceof Uri)) {
        const uris = context as Uri[];
        const projects = wm.getProjects(uris).map((p) => p);
        const projectEnvManagers = em.getProjectEnvManagers(uris);
        const recommended =
            projectEnvManagers.length === 1 && uris.length === 1 ? await projectEnvManagers[0].get(uris[0]) : undefined;
        const selected = await pickEnvironment(em.managers, projectEnvManagers, {
            projects,
            recommended,
            showBackButton: uris.length > 1,
        });

        if (selected) {
            // Use the same logic for checking already set environments
            await setEnvironmentForProjects(projects, selected, em);
        }
    } else {
        traceError(`Invalid context for setting environment command: ${context}`);
        showErrorMessage('Invalid context for setting environment');
    }
}
/**
 * Sets the environment for the given projects, showing a warning for those already set.
 * @param selectedProjects Array of  PythonProject selected by user
 * @param environment The environment to set for the projects
 * @param em The EnvironmentManagers instance
 */
async function setEnvironmentForProjects(
    selectedProjects: PythonProject[],
    environment: PythonEnvironment,
    em: EnvironmentManagers,
) {
    let alreadySet: PythonProject[] = [];
    for (const p of selectedProjects) {
        const currentEnv = await em.getEnvironment(p.uri);
        if (currentEnv?.envId.id === environment.envId.id) {
            alreadySet.push(p);
        }
    }
    if (alreadySet.length > 0) {
        const env = alreadySet.length > 1 ? 'environments' : 'environment';
        showInformationMessage(
            `"${environment.name}" is already selected as the ${env} for: ${alreadySet
                .map((p) => `"${p.name}"`)
                .join(', ')}`,
        );
    }
    const toSet: PythonProject[] = selectedProjects.filter((p) => !alreadySet.includes(p));
    const uris = toSet.map((p) => p.uri);
    if (uris.length === 0) {
        return;
    }
    await em.setEnvironments(uris, environment);
}

export async function setEnvManagerCommand(em: EnvironmentManagers, wm: PythonProjectManager): Promise<void> {
    const projects = await pickProjectMany(wm.getProjects());
    if (projects && projects.length > 0) {
        const manager = await pickEnvironmentManager(em.managers);
        if (manager) {
            await setEnvironmentManager(projects.map((p) => ({ project: p, envManager: manager })));
        }
    }
}

export async function setPackageManagerCommand(em: EnvironmentManagers, wm: PythonProjectManager): Promise<void> {
    const projects = await pickProjectMany(wm.getProjects());
    if (projects && projects.length > 0) {
        const manager = await pickPackageManager(em.packageManagers);
        if (manager) {
            await setPackageManager(projects.map((p) => ({ project: p, packageManager: manager })));
        }
    }
}

/**
 * Creates a new Python project using a selected PythonProjectCreator.
 *
 * This function calls create on the selected creator and handles the creation process. Will return
 * without doing anything if the resource is a ProjectItem, as the project is already created.
 *
 * @param resource - The resource to use for project creation (can be a Uri(s), ProjectItem(s), or undefined).
 * @param wm - The PythonProjectManager instance for managing projects.
 * @param em - The EnvironmentManagers instance for managing environments.
 * @param pc - The ProjectCreators instance for accessing available project creators.
 * @returns A promise that resolves when the project has been created, or void if cancelled or invalid.
 */
export async function addPythonProjectCommand(
    resource: unknown,
    wm: PythonProjectManager,
    em: EnvironmentManagers,
    pc: ProjectCreators,
): Promise<void> {
    if (wm.getProjects().length === 0) {
        const r = await showErrorMessage(
            'Please open a folder/project to create a Python project.',
            {
                modal: true,
            },
            'Open Folder',
        );
        if (r === 'Open Folder') {
            await commands.executeCommand('vscode.openFolder');
            return;
        }
    }
    if (resource instanceof Array) {
        for (const r of resource) {
            await addPythonProjectCommand(r, wm, em, pc);
            return;
        }
    }
    if (resource instanceof ProjectItem) {
        // If the context is a ProjectItem, project is already created. Just add it to the package manager project list.
        wm.add(resource.project);
        return;
    }
    let options: PythonProjectCreatorOptions | undefined;

    if (resource instanceof Uri) {
        // Use resource as the URI for the project if it is a URI.
        options = {
            name: resource.fsPath,
            rootUri: resource,
        };

        // When a URI is provided (right-click in explorer), directly use the existingProjects creator
        const existingProjectsCreator = pc.getProjectCreators().find((c) => c.name === 'existingProjects');
        if (existingProjectsCreator) {
            try {
                if (existingProjectsCreator.supportsQuickCreate) {
                    options = {
                        ...options,
                        quickCreate: true,
                    };
                }
                await existingProjectsCreator.create(options);
                // trigger refresh to populate environments within the new project
                await Promise.all(em.managers.map((m) => m.refresh(options?.rootUri)));
                return;
            } catch (ex) {
                if (ex === QuickInputButtons.Back) {
                    return addPythonProjectCommand(resource, wm, em, pc);
                }
                throw ex;
            }
        }
    }

    // If not a URI or existingProjectsCreator not found, fall back to picker
    const creator: PythonProjectCreator | undefined = await pickCreator(pc.getProjectCreators());
    if (!creator) {
        return;
    }

    // if multiroot, prompt the user to select which workspace to create the project in
    const workspaceFolders = workspace.workspaceFolders;
    if (!resource && workspaceFolders && workspaceFolders.length > 1) {
        try {
            const workspace = await pickWorkspaceFolder(true);
            resource = workspace?.uri;
        } catch (ex) {
            if (ex === QuickInputButtons.Back) {
                return addPythonProjectCommand(resource, wm, em, pc);
            }
            throw ex;
        }
    }

    try {
        await creator.create(options);
        // trigger refresh to populate environments within the new project
        await Promise.all(em.managers.map((m) => m.refresh(options?.rootUri)));
    } catch (ex) {
        if (ex === QuickInputButtons.Back) {
            return addPythonProjectCommand(resource, wm, em, pc);
        }
        throw ex;
    }
}

export async function removePythonProject(item: ProjectItem, wm: PythonProjectManager): Promise<void> {
    await removePythonProjectSetting([{ project: item.project }]);
    wm.remove(item.project);
}

export async function getPackageCommandOptions(
    e: unknown,
    em: EnvironmentManagers,
    pm: PythonProjectManager,
): Promise<{
    packageManager: InternalPackageManager;
    environment: PythonEnvironment;
}> {
    if (e === undefined) {
        const project = await pickProject(pm.getProjects());
        if (project) {
            return getPackageCommandOptions(project.uri, em, pm);
        }
    }

    if (e instanceof ProjectEnvironment) {
        const environment = e.environment;
        const packageManager = em.getPackageManager(e.parent.project.uri);
        if (packageManager) {
            return { environment, packageManager };
        }
    }

    if (e instanceof PythonEnvTreeItem) {
        const environment = e.environment;
        const packageManager = em.getPackageManager(environment);
        if (packageManager) {
            return { environment, packageManager };
        }
    }

    if (e instanceof Uri) {
        const environment = await em.getEnvironmentManager(e)?.get(e);
        const packageManager = em.getPackageManager(e);
        if (environment && packageManager) {
            return { environment, packageManager };
        }
    }

    throw new Error(`Invalid context for package command: ${e}`);
}

export async function createTerminalCommand(
    context: unknown,
    api: PythonEnvironmentApi,
    tm: TerminalManager,
): Promise<Terminal | undefined> {
    if (context === undefined) {
        const pw = await pickProject(api.getPythonProjects());
        if (pw) {
            const env = await api.getEnvironment(pw.uri);
            const cwd = await findParentIfFile(pw.uri.fsPath);
            if (env) {
                return await tm.create(env, { cwd });
            }
        }
    } else if (context instanceof Uri) {
        const uri = context as Uri;
        const env = await api.getEnvironment(uri);
        const pw = api.getPythonProject(uri);
        if (env && pw) {
            const cwd = await findParentIfFile(pw.uri.fsPath);
            return await tm.create(env, { cwd });
        }
    } else if (context instanceof ProjectItem) {
        const view = context as ProjectItem;
        const env = await api.getEnvironment(view.project.uri);
        const cwd = await findParentIfFile(view.project.uri.fsPath);
        if (env) {
            const terminal = await tm.create(env, { cwd });
            terminal.show();
            return terminal;
        }
    } else if (context instanceof GlobalProjectItem) {
        const env = await api.getEnvironment(undefined);
        if (env) {
            const terminal = await tm.create(env, { cwd: undefined });
            terminal.show();
            return terminal;
        }
    } else if (context instanceof PythonEnvTreeItem) {
        const view = context as PythonEnvTreeItem;
        const pw = await pickProject(api.getPythonProjects());
        if (pw) {
            const cwd = await findParentIfFile(pw.uri.fsPath);
            const terminal = await tm.create(view.environment, { cwd });
            terminal.show();
            return terminal;
        }
    }
}

export async function findParentIfFile(cwd: string): Promise<string> {
    const stat = await fs.stat(cwd);
    if (stat.isFile()) {
        // If the project is a file, use the directory of the file as the cwd
        return path.dirname(cwd);
    }
    return cwd;
}

export async function runInTerminalCommand(
    item: unknown,
    api: PythonEnvironmentApi,
    tm: TerminalManager,
): Promise<void> {
    if (item instanceof Uri) {
        const uri = item as Uri;
        const project = api.getPythonProject(uri);
        const environment = await api.getEnvironment(uri);
        if (environment && project) {
            const resolvedEnv = await api.resolveEnvironment(environment.environmentPath);
            const envFinal = resolvedEnv ?? environment;
            const terminal = await tm.getProjectTerminal(project, envFinal);
            await runInTerminal(envFinal, terminal, {
                cwd: project.uri,
                args: [item.fsPath],
                show: true,
            });
        }
    }
    throw new Error(`Invalid context for run-in-terminal: ${item}`);
}

export async function runInDedicatedTerminalCommand(
    item: unknown,
    api: PythonEnvironmentApi,
    tm: TerminalManager,
): Promise<void> {
    if (item instanceof Uri) {
        const uri = item as Uri;
        const project = api.getPythonProject(uri);
        const environment = await api.getEnvironment(uri);

        if (environment && project) {
            const resolvedEnv = await api.resolveEnvironment(environment.environmentPath);
            const envFinal = resolvedEnv ?? environment;
            const terminal = await tm.getDedicatedTerminal(item, project, envFinal);
            await runInTerminal(envFinal, terminal, {
                cwd: project.uri,
                args: [item.fsPath],
                show: true,
            });
        }
    }
    throw new Error(`Invalid context for run-in-terminal: ${item}`);
}

export async function runAsTaskCommand(item: unknown, api: PythonEnvironmentApi): Promise<TaskExecution | undefined> {
    if (item instanceof Uri) {
        const uri = item as Uri;
        const project = api.getPythonProject(uri);
        const environment = await api.getEnvironment(uri);
        if (environment) {
            const resolvedEnv = await api.resolveEnvironment(environment.environmentPath);
            const envFinal = resolvedEnv ?? environment;
            return await runAsTask(
                envFinal,
                {
                    project,
                    args: [item.fsPath],
                    name: 'Python Run',
                },

                { reveal: TaskRevealKind.Always },
            );
        }
    } else if (item === undefined) {
        const uri = activeTextEditor()?.document.uri;
        if (uri) {
            return runAsTaskCommand(uri, api);
        }
    }
}

export async function copyPathToClipboard(item: unknown): Promise<void> {
    if (item instanceof ProjectItem) {
        const projectPath = item.project.uri.fsPath;
        await clipboardWriteText(projectPath);
        traceInfo(`Copied project path to clipboard: ${projectPath}`);
    } else if (item instanceof ProjectEnvironment || item instanceof PythonEnvTreeItem) {
        const run = item.environment.execInfo.run;
        const envPath = run.executable;
        await clipboardWriteText(envPath);
        traceInfo(`Copied environment path to clipboard: ${envPath}`);
    } else {
        traceVerbose(`Invalid context for copy path to clipboard: ${item}`);
    }
}

export async function revealProjectInExplorer(item: unknown): Promise<void> {
    if (item instanceof ProjectItem) {
        const projectUri = item.project.uri;
        await commands.executeCommand('revealInExplorer', projectUri);
    } else {
        traceVerbose(`Invalid context for reveal project in explorer: ${item}`);
    }
}
