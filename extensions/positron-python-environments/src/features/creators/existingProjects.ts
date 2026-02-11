import * as path from 'path';
import { Uri, window, workspace } from 'vscode';
import { PythonProject, PythonProjectCreator, PythonProjectCreatorOptions } from '../../api';
import { ProjectCreatorString } from '../../common/localize';
import { traceInfo, traceLog } from '../../common/logging';
import { showOpenDialog, showWarningMessage } from '../../common/window.apis';
import { PythonProjectManager, PythonProjectsImpl } from '../../internal.api';

export class ExistingProjects implements PythonProjectCreator {
    public readonly name = 'existingProjects';
    public readonly displayName = ProjectCreatorString.addExistingProjects;

    constructor(private readonly pm: PythonProjectManager) {}

    async create(
        _options?: PythonProjectCreatorOptions,
    ): Promise<PythonProject | PythonProject[] | Uri | Uri[] | undefined> {
        let existingAddUri: Uri[] | undefined;
        if (_options?.rootUri) {
            // If rootUri is provided, do not prompt
            existingAddUri = [_options.rootUri];
        } else if (_options?.quickCreate) {
            // If quickCreate is true & no rootUri is provided, we should not prompt for any input
            throw new Error('Root URI is required in quickCreate mode.');
        } else {
            // Prompt the user to select files or folders
            existingAddUri = await showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: true,
                canSelectMany: true,
                filters: {
                    python: ['py'],
                },
                title: ProjectCreatorString.selectFilesOrFolders,
            });
        }

        if (!existingAddUri || existingAddUri.length === 0) {
            // User cancelled the dialog & doesn't want to add any projects
            return;
        }

        // do we have any limitations that need to be applied here?
        // like selected folder not child of workspace folder?

        const filtered = existingAddUri.filter((uri) => {
            const p = this.pm.get(uri);
            if (p) {
                // Skip this project if there's already a project registered with exactly the same path
                const np = path.normalize(p.uri.fsPath);
                const nf = path.normalize(uri.fsPath);
                return np !== nf;
            }
            return true;
        });

        if (filtered.length === 0) {
            // No new projects found that are not already in the project manager
            const formattedProjectPaths =
                existingAddUri === undefined ? 'None' : existingAddUri.map((uri) => uri.fsPath).join(', ');
            traceInfo(
                `All selected resources are already registered in the project manager. Resources selected: ${formattedProjectPaths}`,
            );
            setImmediate(() => {
                if (existingAddUri && existingAddUri.length === 1) {
                    showWarningMessage(`Selected resource already exists as project.`);
                } else {
                    showWarningMessage('Selected resources already exist as projects.');
                }
            });
            return;
        }

        // for all the selected files / folders, check to make sure they are in the workspace
        const resultsOutsideWorkspace: Uri[] = [];
        const workspaceRoots: Uri[] = workspace.workspaceFolders?.map((w) => w.uri) || [];
        const resultsInWorkspace = filtered.filter((r) => {
            const exists = workspaceRoots.some((w) => r.fsPath.startsWith(w.fsPath));
            if (!exists) {
                traceLog(`File ${r.fsPath} is not in the workspace, ignoring it from 'add projects' list.`);
                resultsOutsideWorkspace.push(r);
            }
            return exists;
        });
        if (resultsInWorkspace.length === 0) {
            // Show a single error message with option to add to workspace
            const response = await window.showErrorMessage(
                'Selected items are not in the current workspace.',
                'Add to Workspace',
                'Cancel',
            );

            if (response === 'Add to Workspace') {
                // Use the command palette to let user adjust which folders to add
                // Add folders programmatically using workspace API
                for (const r of resultsOutsideWorkspace) {
                    // if the user selects a file, add that file to the workspace
                    await // if the user selects a folder, add that folder to the workspace
                    await workspace.updateWorkspaceFolders(
                        workspace.workspaceFolders?.length || 0, // Start index
                        0, // Delete count
                        {
                            uri: r,
                        },
                    );
                }
            }
            return;
        } else {
            const projects = resultsInWorkspace.map(
                (uri) => new PythonProjectsImpl(path.basename(uri.fsPath), uri),
            ) as PythonProject[];
            // Add the projects to the project manager
            this.pm.add(projects);
            return projects;
        }
    }
}
