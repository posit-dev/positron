/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import * as sinon from 'sinon';
import { EventEmitter, FileSystemWatcher, GlobPattern, RelativePattern, Uri, WorkspaceFolder } from 'vscode';
import { FileChangeType } from '../../../../../client/common/platform/fileSystemWatcher';
import * as workspaceApis from '../../../../../client/common/vscodeApis/workspaceApis';
import {
    createPythonWatcher,
    PythonWorkspaceEnvEvent,
} from '../../../../../client/pythonEnvironments/base/locators/common/pythonWatcher';

/** A file system watcher whose events the test fires by hand. */
interface FakeWatcher {
    pattern: string;
    ignoreCreateEvents?: boolean;
    ignoreChangeEvents?: boolean;
    ignoreDeleteEvents?: boolean;
    deleted: EventEmitter<Uri>;
}

suite('Python watcher', () => {
    const workspaceFolder: WorkspaceFolder = {
        uri: Uri.file(path.join(path.sep, 'home', 'user', 'project')),
        name: 'project',
        index: 0,
    };
    let watchers: FakeWatcher[];

    setup(() => {
        watchers = [];
        sinon.stub(workspaceApis, 'getWorkspaceFolder').returns(workspaceFolder);
        sinon
            .stub(workspaceApis, 'createFileSystemWatcher')
            .callsFake((globPattern: GlobPattern, ignoreCreateEvents, ignoreChangeEvents, ignoreDeleteEvents) => {
                const deleted = new EventEmitter<Uri>();
                watchers.push({
                    pattern: (globPattern as RelativePattern).pattern,
                    ignoreCreateEvents,
                    ignoreChangeEvents,
                    ignoreDeleteEvents,
                    deleted,
                });
                const noEvents = () => ({ dispose: () => undefined });
                return {
                    onDidCreate: noEvents,
                    onDidChange: noEvents,
                    onDidDelete: deleted.event,
                    dispose: () => deleted.dispose(),
                } as unknown as FileSystemWatcher;
            });
    });

    teardown(() => {
        sinon.restore();
    });

    test('a deleted folder in the workspace is reported as a deleted workspace path', () => {
        // Deleting a folder is reported as one delete for the folder, so `rm -rf .venv`
        // never reaches the `**/python` watcher.
        const watcher = createPythonWatcher();
        const events: PythonWorkspaceEnvEvent[] = [];
        watcher.onDidWorkspaceEnvChanged((e) => events.push(e));
        watcher.watchWorkspace(workspaceFolder);

        const deleteWatcher = watchers.find((w) => w.pattern === '**');
        const venvDir = path.join(workspaceFolder.uri.fsPath, '.venv');
        deleteWatcher?.deleted.fire(Uri.file(venvDir));

        assert.deepStrictEqual(
            {
                deleteWatcher: deleteWatcher && {
                    ignoreCreateEvents: deleteWatcher.ignoreCreateEvents,
                    ignoreChangeEvents: deleteWatcher.ignoreChangeEvents,
                    ignoreDeleteEvents: deleteWatcher.ignoreDeleteEvents,
                },
                events: events.map((e) => ({ type: e.type, executable: e.executable })),
            },
            {
                deleteWatcher: { ignoreCreateEvents: true, ignoreChangeEvents: true, ignoreDeleteEvents: false },
                events: [{ type: FileChangeType.Deleted, executable: venvDir }],
            },
        );
        watcher.dispose();
    });
});
