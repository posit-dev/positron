import * as path from 'path';
import { Disposable, EventEmitter, MarkdownString, Uri, workspace } from 'vscode';
import { IconPath, PythonProject } from '../api';
import { DEFAULT_ENV_MANAGER_ID, DEFAULT_PACKAGE_MANAGER_ID } from '../common/constants';
import { createSimpleDebounce } from '../common/utils/debounce';
import {
    getConfiguration,
    getWorkspaceFolders,
    onDidChangeConfiguration,
    onDidChangeWorkspaceFolders,
} from '../common/workspace.apis';
import { PythonProjectManager, PythonProjectSettings, PythonProjectsImpl } from '../internal.api';
import {
    addPythonProjectSetting,
    EditProjectSettings,
    getDefaultEnvManagerSetting,
    getDefaultPkgManagerSetting,
} from './settings/settingHelpers';

type ProjectArray = PythonProject[];

export class PythonProjectManagerImpl implements PythonProjectManager {
    private disposables: Disposable[] = [];
    private _projects = new Map<string, PythonProject>();
    private readonly _onDidChangeProjects = new EventEmitter<ProjectArray | undefined>();
    public readonly onDidChangeProjects = this._onDidChangeProjects.event;

    // Debounce the updateProjects method to avoid excessive update calls
    private readonly updateDebounce = createSimpleDebounce(100, () => this.updateProjects());

    initialize(): void {
        this.add(this.getInitialProjects());
        this.disposables.push(
            this._onDidChangeProjects,
            new Disposable(() => this._projects.clear()),
            onDidChangeWorkspaceFolders(() => {
                this.updateDebounce.trigger();
            }),
            onDidChangeConfiguration((e) => {
                if (
                    e.affectsConfiguration('python-envs.defaultEnvManager') ||
                    e.affectsConfiguration('python-envs.pythonProjects') ||
                    e.affectsConfiguration('python-envs.defaultPackageManager')
                ) {
                    this.updateDebounce.trigger();
                }
            }),
        );
    }

    /**
     *
     * Gathers the projects which are configured in settings and all workspace roots.
     * @returns An array of PythonProject objects representing the initial projects.
     */
    private getInitialProjects(): ProjectArray {
        const newProjects: ProjectArray = [];
        const workspaces = getWorkspaceFolders() ?? [];
        for (const w of workspaces) {
            const config = getConfiguration('python-envs', w.uri);
            const overrides = config.get<PythonProjectSettings[]>('pythonProjects', []);

            // Add the workspace root as a project if not already present
            if (!newProjects.some((p) => p.uri.toString() === w.uri.toString())) {
                newProjects.push(new PythonProjectsImpl(w.name, w.uri));
            }

            // For each override, resolve its path and add as a project if not already present
            for (const o of overrides) {
                let uriFromWorkspace: Uri | undefined = undefined;
                // if override has a workspace property, resolve the path relative to that workspace
                if (o.workspace) {
                    //
                    const workspaceFolder = workspaces.find((ws) => ws.name === o.workspace);
                    if (workspaceFolder) {
                        if (workspaceFolder.uri.toString() !== w.uri.toString()) {
                            continue; // skip if the workspace is not the same as the current workspace
                        }
                        uriFromWorkspace = Uri.file(path.resolve(workspaceFolder.uri.fsPath, o.path));
                    }
                }
                const uri = uriFromWorkspace ? uriFromWorkspace : Uri.file(path.resolve(w.uri.fsPath, o.path));

                // Check if the project already exists in the newProjects array
                if (!newProjects.some((p) => p.uri.toString() === uri.toString())) {
                    newProjects.push(new PythonProjectsImpl(o.path, uri));
                }
            }
        }
        return newProjects;
    }

    /**
     * Get initial projects from the workspace(s) config settings
     * then updates the internal _projects map to reflect the current state and
     * fires the onDidChangeProjects event if there are any changes.
     */
    private updateProjects(): void {
        const newProjects: ProjectArray = this.getInitialProjects();
        const existingProjects = Array.from(this._projects.values());

        // Remove projects that are no longer in the workspace settings
        const projectsToRemove = existingProjects.filter(
            (w) => !newProjects.find((n) => n.uri.toString() === w.uri.toString()),
        );
        projectsToRemove.forEach((w) => this._projects.delete(w.uri.toString()));

        // Add new projects that are in the workspace settings but not in the existing projects
        const projectsToAdd = newProjects.filter(
            (n) => !existingProjects.find((w) => w.uri.toString() === n.uri.toString()),
        );
        projectsToAdd.forEach((w) => this._projects.set(w.uri.toString(), w));

        if (projectsToRemove.length > 0 || projectsToAdd.length > 0) {
            this._onDidChangeProjects.fire(Array.from(this._projects.values()));
        }
    }

    create(
        name: string,
        uri: Uri,
        options?: { description?: string; tooltip?: string | MarkdownString; iconPath?: IconPath },
    ): PythonProject {
        return new PythonProjectsImpl(name, uri, options);
    }

    async add(projects: PythonProject | ProjectArray): Promise<void> {
        const _projects = Array.isArray(projects) ? projects : [projects];
        if (_projects.length === 0) {
            return;
        }
        const edits: EditProjectSettings[] = [];

        const envManagerId = getDefaultEnvManagerSetting(this);
        const pkgManagerId = getDefaultPkgManagerSetting(this);

        const globalConfig = workspace.getConfiguration('python-envs', undefined);
        const defaultEnvManager = globalConfig.get<string>('defaultEnvManager', DEFAULT_ENV_MANAGER_ID);
        const defaultPkgManager = globalConfig.get<string>('defaultPackageManager', DEFAULT_PACKAGE_MANAGER_ID);

        _projects.forEach((currProject) => {
            const workspaces = getWorkspaceFolders() ?? [];
            const isRoot = workspaces.some((w) => w.uri.toString() === currProject.uri.toString());
            if (isRoot) {
                // for root projects, add setting if not default
                if (envManagerId !== defaultEnvManager || pkgManagerId !== defaultPkgManager) {
                    edits.push({ project: currProject, envManager: envManagerId, packageManager: pkgManagerId });
                }
            } else {
                // for non-root projects, always add setting
                edits.push({ project: currProject, envManager: envManagerId, packageManager: pkgManagerId });
            }
            // handles adding the project to this._projects map
            return this._projects.set(currProject.uri.toString(), currProject);
        });
        this._onDidChangeProjects.fire(Array.from(this._projects.values()));

        if (edits.length > 0) {
            await addPythonProjectSetting(edits);
        }
    }

    remove(projects: PythonProject | ProjectArray): void {
        const _projects = Array.isArray(projects) ? projects : [projects];
        if (_projects.length === 0) {
            return;
        }

        _projects.forEach((w) => this._projects.delete(w.uri.toString()));
        this._onDidChangeProjects.fire(Array.from(this._projects.values()));
    }

    getProjects(uris?: Uri[]): ReadonlyArray<PythonProject> {
        if (uris === undefined) {
            return Array.from(this._projects.values());
        } else {
            const projects: PythonProject[] = [];
            for (const uri of uris) {
                const project = this.get(uri);
                if (project !== undefined && !projects.includes(project)) {
                    projects.push(project);
                }
            }
            return projects;
        }
    }

    get(uri: Uri): PythonProject | undefined {
        let pythonProject = this._projects.get(uri.toString());
        if (!pythonProject) {
            pythonProject = this.findProjectByUri(uri);
        }
        return pythonProject;
    }

    /**
     * Finds the single project that matches the given URI if it exists.
     * @param uri The URI of the project to find.
     * @returns The project with the given URI, or undefined if not found.
     */
    private findProjectByUri(uri: Uri): PythonProject | undefined {
        const _projects = Array.from(this._projects.values()).sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length);

        const normalizedUriPath = path.normalize(uri.fsPath);
        for (const p of _projects) {
            const normalizedProjectPath = path.normalize(p.uri.fsPath);
            if (this.isUriMatching(normalizedUriPath, normalizedProjectPath)) {
                return p;
            }
        }
        return undefined;
    }

    /**
     * Checks if a given file or folder path (normalizedUriPath)
     * is the same as, or is inside, a project path
     * @normalizedProjectPath Project path to check against.
     * @normalizedUriPath File or folder path to check.
     * @returns true if the file or folder path is the same as or inside the project path, false otherwise.
     */
    private isUriMatching(normalizedUriPath: string, normalizedProjectPath: string): boolean {
        if (normalizedProjectPath === normalizedUriPath) {
            return true;
        }
        let parentPath = path.dirname(normalizedUriPath);
        while (parentPath !== path.dirname(parentPath)) {
            if (normalizedProjectPath === parentPath) {
                return true;
            }
            parentPath = path.dirname(parentPath);
        }
        return false;
    }

    dispose() {
        this.disposables.forEach((d) => d.dispose());
    }
}
