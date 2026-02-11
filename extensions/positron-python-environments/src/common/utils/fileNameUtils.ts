import * as path from 'path';
import * as fsapi from 'fs-extra';
import { KNOWN_FILES, KNOWN_TEMPLATE_ENDINGS } from '../constants';
import { Uri } from 'vscode';
import { getWorkspaceFolders } from '../workspace.apis';

export function isPythonProjectFile(fileName: string): boolean {
    const baseName = path.basename(fileName).toLowerCase();
    const fsPath = path.normalize(fileName).toLowerCase();
    return (
        KNOWN_FILES.some((file) => baseName === file) ||
        KNOWN_TEMPLATE_ENDINGS.some((ending) => baseName.endsWith(ending)) ||
        (baseName.endsWith('.txt') && (baseName.includes('requirements') || baseName.includes('constraints'))) ||
        (baseName.endsWith('.in') && baseName.includes('requirements')) ||
        (fsPath.includes(`requirements${path.sep}`) && (fsPath.endsWith('.txt') || fsPath.endsWith('.in')))
    );
}

export async function getAbsolutePath(fsPath: string): Promise<Uri | undefined> {
    if (path.isAbsolute(fsPath)) {
        return Uri.file(fsPath);
    }

    const workspaceFolders = getWorkspaceFolders() ?? [];
    if (workspaceFolders.length > 0) {
        if (workspaceFolders.length === 1) {
            const absPath = path.resolve(workspaceFolders[0].uri.fsPath, fsPath);
            if (await fsapi.pathExists(absPath)) {
                return Uri.file(absPath);
            }
        } else {
            const workspaces = Array.from(workspaceFolders)
                .sort((a, b) => a.uri.fsPath.length - b.uri.fsPath.length)
                .reverse();
            for (const folder of workspaces) {
                const absPath = path.resolve(folder.uri.fsPath, fsPath);
                if (await fsapi.pathExists(absPath)) {
                    return Uri.file(absPath);
                }
            }
        }
    }
    return undefined;
}
