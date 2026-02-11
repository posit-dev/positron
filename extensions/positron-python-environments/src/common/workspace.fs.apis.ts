import { FileStat, Uri, workspace } from 'vscode';

export function readFile(uri: Uri): Thenable<Uint8Array> {
    return workspace.fs.readFile(uri);
}

export function stat(uri: Uri): Thenable<FileStat> {
    return workspace.fs.stat(uri);
}
