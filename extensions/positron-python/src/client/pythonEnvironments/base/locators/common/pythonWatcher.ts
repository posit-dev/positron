// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Disposable, Event, EventEmitter, GlobPattern, RelativePattern, Uri, WorkspaceFolder } from 'vscode';
import { createFileSystemWatcher, getWorkspaceFolder } from '../../../../common/vscodeApis/workspaceApis';
import { isWindows } from '../../../../common/utils/platform';
import { arePathsSame } from '../../../common/externalDependencies';
import { FileChangeType } from '../../../../common/platform/fileSystemWatcher';

export interface PythonWorkspaceEnvEvent {
    type: FileChangeType;
    workspaceFolder: WorkspaceFolder;
    executable: string;
}

export interface PythonGlobalEnvEvent {
    type: FileChangeType;
    uri: Uri;
}

// --- Start Positron ---
export interface PythonWorkspacePathDeletedEvent {
    workspaceFolder: WorkspaceFolder;
    path: string;
}
// --- End Positron ---

export interface PythonWatcher extends Disposable {
    watchWorkspace(wf: WorkspaceFolder): void;
    unwatchWorkspace(wf: WorkspaceFolder): void;
    onDidWorkspaceEnvChanged: Event<PythonWorkspaceEnvEvent>;
    // --- Start Positron ---
    /**
     * Fires for any file or folder deleted in a watched workspace. Deleting a
     * folder is reported as the folder's deletion, not as the deletion of each
     * file inside it, so `rm -rf .venv` may not fire `onDidWorkspaceEnvChanged`.
     */
    onDidWorkspacePathDeleted: Event<PythonWorkspacePathDeletedEvent>;
    // --- End Positron ---

    watchPath(uri: Uri, pattern?: string): void;
    unwatchPath(uri: Uri): void;
    onDidGlobalEnvChanged: Event<PythonGlobalEnvEvent>;
}

/*
 * The pattern to search for python executables in the workspace.
 * project
 * ├── python or python.exe  <--- This is what we are looking for.
 * ├── .conda
 * │   └── python or python.exe <--- This is what we are looking for.
 * └── .venv
 * │   └── Scripts or bin
 * │       └── python or python.exe <--- This is what we are looking for.
 */
const WORKSPACE_PATTERN = isWindows() ? '**/python.exe' : '**/python';

class PythonWatcherImpl implements PythonWatcher {
    private disposables: Disposable[] = [];

    private readonly _onDidWorkspaceEnvChanged = new EventEmitter<PythonWorkspaceEnvEvent>();

    private readonly _onDidGlobalEnvChanged = new EventEmitter<PythonGlobalEnvEvent>();

    // --- Start Positron ---
    private readonly _onDidWorkspacePathDeleted = new EventEmitter<PythonWorkspacePathDeletedEvent>();
    // --- End Positron ---

    private readonly _disposeMap: Map<string, Disposable> = new Map<string, Disposable>();

    constructor() {
        this.disposables.push(this._onDidWorkspaceEnvChanged, this._onDidGlobalEnvChanged);
        // --- Start Positron ---
        this.disposables.push(this._onDidWorkspacePathDeleted);
        // --- End Positron ---
    }

    onDidGlobalEnvChanged: Event<PythonGlobalEnvEvent> = this._onDidGlobalEnvChanged.event;

    onDidWorkspaceEnvChanged: Event<PythonWorkspaceEnvEvent> = this._onDidWorkspaceEnvChanged.event;

    // --- Start Positron ---
    onDidWorkspacePathDeleted: Event<PythonWorkspacePathDeletedEvent> = this._onDidWorkspacePathDeleted.event;
    // --- End Positron ---

    watchWorkspace(wf: WorkspaceFolder): void {
        if (this._disposeMap.has(wf.uri.fsPath)) {
            const disposer = this._disposeMap.get(wf.uri.fsPath);
            disposer?.dispose();
        }

        const disposables: Disposable[] = [];
        const watcher = createFileSystemWatcher(new RelativePattern(wf, WORKSPACE_PATTERN));
        disposables.push(
            watcher,
            watcher.onDidChange((uri) => {
                this.fireWorkspaceEvent(FileChangeType.Changed, wf, uri);
            }),
            watcher.onDidCreate((uri) => {
                this.fireWorkspaceEvent(FileChangeType.Created, wf, uri);
            }),
            watcher.onDidDelete((uri) => {
                this.fireWorkspaceEvent(FileChangeType.Deleted, wf, uri);
            }),
        );
        // --- Start Positron ---
        // Deletes only. Sends the same watch request as the watcher above, so
        // it adds no file system watcher.
        const deleteWatcher = createFileSystemWatcher(new RelativePattern(wf, '**'), true, true, false);
        disposables.push(
            deleteWatcher,
            deleteWatcher.onDidDelete((uri) => {
                const uriWorkspace = getWorkspaceFolder(uri);
                if (uriWorkspace && arePathsSame(uriWorkspace.uri.fsPath, wf.uri.fsPath)) {
                    this._onDidWorkspacePathDeleted.fire({ workspaceFolder: wf, path: uri.fsPath });
                }
            }),
        );
        // --- End Positron ---

        const disposable = {
            dispose: () => {
                disposables.forEach((d) => d.dispose());
                this._disposeMap.delete(wf.uri.fsPath);
            },
        };
        this._disposeMap.set(wf.uri.fsPath, disposable);
    }

    unwatchWorkspace(wf: WorkspaceFolder): void {
        const disposable = this._disposeMap.get(wf.uri.fsPath);
        disposable?.dispose();
    }

    private fireWorkspaceEvent(type: FileChangeType, wf: WorkspaceFolder, uri: Uri) {
        const uriWorkspace = getWorkspaceFolder(uri);
        if (uriWorkspace && arePathsSame(uriWorkspace.uri.fsPath, wf.uri.fsPath)) {
            this._onDidWorkspaceEnvChanged.fire({ type, workspaceFolder: wf, executable: uri.fsPath });
        }
    }

    watchPath(uri: Uri, pattern?: string): void {
        if (this._disposeMap.has(uri.fsPath)) {
            const disposer = this._disposeMap.get(uri.fsPath);
            disposer?.dispose();
        }

        const glob: GlobPattern = pattern ? new RelativePattern(uri, pattern) : uri.fsPath;
        const disposables: Disposable[] = [];
        const watcher = createFileSystemWatcher(glob);
        disposables.push(
            watcher,
            watcher.onDidChange(() => {
                this._onDidGlobalEnvChanged.fire({ type: FileChangeType.Changed, uri });
            }),
            watcher.onDidCreate(() => {
                this._onDidGlobalEnvChanged.fire({ type: FileChangeType.Created, uri });
            }),
            watcher.onDidDelete(() => {
                this._onDidGlobalEnvChanged.fire({ type: FileChangeType.Deleted, uri });
            }),
        );

        const disposable = {
            dispose: () => {
                disposables.forEach((d) => d.dispose());
                this._disposeMap.delete(uri.fsPath);
            },
        };
        this._disposeMap.set(uri.fsPath, disposable);
    }

    unwatchPath(uri: Uri): void {
        const disposable = this._disposeMap.get(uri.fsPath);
        disposable?.dispose();
    }

    dispose() {
        this.disposables.forEach((d) => d.dispose());
        this._disposeMap.forEach((d) => d.dispose());
    }
}

export function createPythonWatcher(): PythonWatcher {
    return new PythonWatcherImpl();
}
