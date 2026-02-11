import * as path from 'path';
import { Uri } from 'vscode';
import { PythonProject, PythonProjectCreator, PythonProjectCreatorOptions } from '../../api';
import { ProjectCreatorString } from '../../common/localize';
import { traceInfo } from '../../common/logging';
import { showErrorMessage, showQuickPickWithButtons, showWarningMessage } from '../../common/window.apis';
import { findFiles } from '../../common/workspace.apis';
import { PythonProjectManager, PythonProjectsImpl } from '../../internal.api';

function getUniqueUri(uris: Uri[]): {
    label: string;
    description: string;
    uri: Uri;
}[] {
    const files = uris.map((uri) => uri.fsPath).sort();
    const dirs: Map<string, string> = new Map();
    files.forEach((file) => {
        const dir = path.dirname(file);
        if (dirs.has(dir)) {
            return;
        }
        dirs.set(dir, file);
    });
    return Array.from(dirs.entries())
        .map(([dir, file]) => ({
            label: path.basename(dir),
            description: file,
            uri: Uri.file(dir),
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

async function pickProjects(uris: Uri[]): Promise<Uri[] | undefined> {
    const items = getUniqueUri(uris);

    const selected = await showQuickPickWithButtons(items, {
        canPickMany: true,
        ignoreFocusOut: true,
        placeHolder: ProjectCreatorString.selectProjects,
        showBackButton: true,
    });

    if (Array.isArray(selected)) {
        return selected.map((s) => s.uri);
    } else if (selected) {
        return [selected.uri];
    }

    return undefined;
}

export class AutoFindProjects implements PythonProjectCreator {
    public readonly name = 'autoProjects';
    public readonly displayName = ProjectCreatorString.autoFindProjects;
    public readonly description = ProjectCreatorString.autoFindProjectsDescription;

    supportsQuickCreate = true;

    constructor(private readonly pm: PythonProjectManager) {}

    async create(_options?: PythonProjectCreatorOptions): Promise<PythonProject | PythonProject[] | undefined> {
        const files = await findFiles('**/{pyproject.toml,setup.py}', '**/.venv/**');
        if (!files || files.length === 0) {
            setImmediate(() => {
                showErrorMessage('No projects found');
            });
            return;
        }

        const filtered = files.filter((uri) => {
            const p = this.pm.get(uri);
            if (p) {
                // Skip this project if:
                // 1. There's already a project registered with exactly the same path
                // 2. There's already a project registered with this project's parent directory path
                const np = path.normalize(p.uri.fsPath);
                const nf = path.normalize(uri.fsPath);
                const nfp = path.dirname(nf);
                return np !== nf && np !== nfp;
            }
            return true;
        });

        if (filtered.length === 0) {
            // No new projects found that are not already in the project manager
            traceInfo(
                `All selected resources are already registered in the project manager: ${files
                    .map((uri) => uri.fsPath)
                    .join(', ')}`,
            );
            setImmediate(() => {
                if (files.length === 1) {
                    showWarningMessage(`${files[0].fsPath} already exists as project.`);
                } else {
                    showWarningMessage('Selected resources already exist as projects.');
                }
            });
            return;
        }

        traceInfo(`Found ${filtered.length} new potential projects that aren't already registered`);

        const projectUris = await pickProjects(filtered);
        if (!projectUris || projectUris.length === 0) {
            // User cancelled the selection.
            traceInfo('User cancelled project selection.');
            return;
        }
        const projects = projectUris.map(
            (uri) => new PythonProjectsImpl(path.basename(uri.fsPath), uri),
        ) as PythonProject[];
        // Add the projects to the project manager
        this.pm.add(projects);
        return projects;
    }
}
