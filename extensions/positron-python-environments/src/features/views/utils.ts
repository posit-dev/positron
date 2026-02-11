import * as path from 'path';
import { PythonProject } from '../../api';
import { getWorkspaceFolder } from '../../common/workspace.apis';

export function removable(project: PythonProject): boolean {
    const workspace = getWorkspaceFolder(project.uri);
    if (workspace) {
        // If the project path is same as the workspace path, then we cannot remove the project.
        return path.normalize(workspace?.uri.fsPath).toLowerCase() !== path.normalize(project.uri.fsPath).toLowerCase();
    }
    return true;
}
