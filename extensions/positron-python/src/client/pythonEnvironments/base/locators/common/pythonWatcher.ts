// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Disposable, Event, EventEmitter, GlobPattern, RelativePattern, Uri, WorkspaceFolder } from 'vscode';
import { createFileSystemWatcher, getWorkspaceFolder } from '../../../../common/vscodeApis/workspaceApis';
import { isWindows } from '../../../../common/utils/platform';
import { arePathsSame } from '../../../common/externalDependencies';
import { FileChangeType } from '../../../../common/platform/fileSystemWatcher';
// --- Start Positron ---
import * as path from 'path';
import { pathExists } from '../../../common/externalDependencies';
import { sleep } from '../../../../common/utils/async';
import { getOSType, OSType } from '../../../../common/utils/platform';
// --- End Positron ---

export interface PythonWorkspaceEnvEvent {
    type: FileChangeType;
    workspaceFolder: WorkspaceFolder;
    executable: string;
}

export interface PythonGlobalEnvEvent {
    type: FileChangeType;
    uri: Uri;
}

export interface PythonWatcher extends Disposable {
    watchWorkspace(wf: WorkspaceFolder): void;
    unwatchWorkspace(wf: WorkspaceFolder): void;
    onDidWorkspaceEnvChanged: Event<PythonWorkspaceEnvEvent>;

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

// --- Start Positron ---
/** Where an env's executable sits in a created folder, matching the tree above. */
const CREATED_FOLDER_EXECUTABLES = isWindows()
    ? ['python.exe', path.join('Scripts', 'python.exe')]
    : ['python', path.join('bin', 'python')];

/**
 * Looks for an env executable in a created folder. An env still being written (it
 * has `pyvenv.cfg` but no executable yet) is checked again, up to 10 times 200ms
 * apart; any other folder is checked once.
 */
async function findCreatedEnvExecutable(folder: string): Promise<string | undefined> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        if (attempt > 0) {
            await sleep(200);
        }
        for (const candidate of CREATED_FOLDER_EXECUTABLES) {
            const executable = path.join(folder, candidate);
            if (await pathExists(executable)) {
                return executable;
            }
        }
        if (!(await pathExists(path.join(folder, 'pyvenv.cfg')))) {
            return undefined;
        }
    }
    return undefined;
}
// --- End Positron ---

class PythonWatcherImpl implements PythonWatcher {
    private disposables: Disposable[] = [];

    private readonly _onDidWorkspaceEnvChanged = new EventEmitter<PythonWorkspaceEnvEvent>();

    private readonly _onDidGlobalEnvChanged = new EventEmitter<PythonGlobalEnvEvent>();

    private readonly _disposeMap: Map<string, Disposable> = new Map<string, Disposable>();

    constructor() {
        this.disposables.push(this._onDidWorkspaceEnvChanged, this._onDidGlobalEnvChanged);
    }

    onDidGlobalEnvChanged: Event<PythonGlobalEnvEvent> = this._onDidGlobalEnvChanged.event;

    onDidWorkspaceEnvChanged: Event<PythonWorkspaceEnvEvent> = this._onDidWorkspaceEnvChanged.event;

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
        // Deleting a folder is reported as one delete for the folder, not one per
        // file inside it, so `rm -rf .venv` may never match the pattern above.
        // Report every deleted path. This sends the same watch request as the
        // watcher above, so it adds no file system watcher.
        // On Linux, a new folder is reported but not what is created inside it
        // before the folder is watched, so `uv venv` may never match the pattern
        // above either. Look for an env executable in each created path. The
        // macOS and Windows watchers are recursive, so they report the executable.
        const watchCreates = getOSType() === OSType.Linux;
        const folderWatcher = createFileSystemWatcher(new RelativePattern(wf, '**'), !watchCreates, true, false);
        let disposed = false;
        disposables.push(
            folderWatcher,
            folderWatcher.onDidDelete((uri) => {
                this.fireWorkspaceEvent(FileChangeType.Deleted, wf, uri);
            }),
            folderWatcher.onDidCreate(async (uri) => {
                const executable = await findCreatedEnvExecutable(uri.fsPath);
                if (executable && !disposed) {
                    this.fireWorkspaceEvent(FileChangeType.Created, wf, Uri.file(executable));
                }
            }),
            {
                dispose: () => {
                    disposed = true;
                },
            },
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
