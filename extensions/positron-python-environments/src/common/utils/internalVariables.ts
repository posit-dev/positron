import { Uri } from 'vscode';
import { getWorkspaceFolder, getWorkspaceFolders } from '../workspace.apis';

export function resolveVariables(value: string, project?: Uri, env?: { [key: string]: string }): string {
    const substitutions = new Map<string, string>();
    const home = process.env.HOME || process.env.USERPROFILE;
    if (home) {
        substitutions.set('${userHome}', home);
    }

    if (project) {
        substitutions.set('${pythonProject}', project.fsPath);
    }

    const workspace = project ? getWorkspaceFolder(project) : undefined;
    if (workspace) {
        substitutions.set('${workspaceFolder}', workspace.uri.fsPath);
    }
    substitutions.set('${cwd}', process.cwd());
    (getWorkspaceFolders() ?? []).forEach((w) => {
        substitutions.set('${workspaceFolder:' + w.name + '}', w.uri.fsPath);
    });

    const substEnv = env || process.env;
    if (substEnv) {
        for (const [key, value] of Object.entries(substEnv)) {
            if (value && key.length > 0) {
                substitutions.set('${env:' + key + '}', value);
            }
        }
    }

    let result = value;
    substitutions.forEach((v, k) => {
        while (k.length > 0 && result.indexOf(k) >= 0) {
            result = result.replace(k, v);
        }
    });
    return result;
}
