/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import { EventEmitter, FileSystemWatcher, GlobPattern, RelativePattern, Uri, WorkspaceFolder } from 'vscode';
import { FileChangeType } from '../../../../../client/common/platform/fileSystemWatcher';
import * as platform from '../../../../../client/common/utils/platform';
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
    created: EventEmitter<Uri>;
    deleted: EventEmitter<Uri>;
}

suite('Python watcher', () => {
    const workspaceFolder: WorkspaceFolder = {
        uri: Uri.file(path.join(path.sep, 'home', 'user', 'project')),
        name: 'project',
        index: 0,
    };
    let watchers: FakeWatcher[];
    let osType: sinon.SinonStub;

    setup(() => {
        watchers = [];
        // Created folders are looked into on Linux only.
        osType = sinon.stub(platform, 'getOSType').returns(platform.OSType.Linux);
        sinon.stub(workspaceApis, 'getWorkspaceFolder').returns(workspaceFolder);
        sinon
            .stub(workspaceApis, 'createFileSystemWatcher')
            .callsFake((globPattern: GlobPattern, ignoreCreateEvents, ignoreChangeEvents, ignoreDeleteEvents) => {
                const created = new EventEmitter<Uri>();
                const deleted = new EventEmitter<Uri>();
                watchers.push({
                    pattern: (globPattern as RelativePattern).pattern,
                    ignoreCreateEvents,
                    ignoreChangeEvents,
                    ignoreDeleteEvents,
                    created,
                    deleted,
                });
                const noEvents = () => ({ dispose: () => undefined });
                return {
                    onDidCreate: created.event,
                    onDidChange: noEvents,
                    onDidDelete: deleted.event,
                    dispose: () => {
                        created.dispose();
                        deleted.dispose();
                    },
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

        const folderWatcher = watchers.find((w) => w.pattern === '**');
        const venvDir = path.join(workspaceFolder.uri.fsPath, '.venv');
        folderWatcher?.deleted.fire(Uri.file(venvDir));

        assert.deepStrictEqual(
            {
                folderWatcher: folderWatcher && {
                    ignoreCreateEvents: folderWatcher.ignoreCreateEvents,
                    ignoreChangeEvents: folderWatcher.ignoreChangeEvents,
                    ignoreDeleteEvents: folderWatcher.ignoreDeleteEvents,
                },
                events: events.map((e) => ({ type: e.type, executable: e.executable })),
            },
            {
                folderWatcher: { ignoreCreateEvents: false, ignoreChangeEvents: true, ignoreDeleteEvents: false },
                events: [{ type: FileChangeType.Deleted, executable: venvDir }],
            },
        );
        watcher.dispose();
    });

    test('on macOS and Windows, created paths are left to the executable watcher', () => {
        // Their watchers are recursive, so they report the executable itself.
        const ignored = [platform.OSType.OSX, platform.OSType.Windows].map((os) => {
            watchers = [];
            osType.returns(os);
            const watcher = createPythonWatcher();
            watcher.watchWorkspace(workspaceFolder);
            watcher.dispose();
            return watchers.find((w) => w.pattern === '**')?.ignoreCreateEvents;
        });
        assert.deepStrictEqual(ignored, [true, true]);
    });

    suite('a created folder', () => {
        // On Linux the file watcher reports a new folder but not what is created inside
        // it before the folder is watched, so `uv venv` never reaches the `**/python`
        // watcher.
        const executable =
            process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python');
        let root: string;
        let folder: WorkspaceFolder;

        setup(() => {
            root = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-python-watcher-'));
            folder = { uri: Uri.file(root), name: 'project', index: 0 };
            (workspaceApis.getWorkspaceFolder as sinon.SinonStub).returns(folder);
        });

        teardown(() => {
            fs.rmSync(root, { recursive: true, force: true });
        });

        /** Watches `folder`, fires a create for `created`, and collects events for `waitMs`. */
        async function eventsAfterCreate(created: string, waitMs: number): Promise<PythonWorkspaceEnvEvent[]> {
            const watcher = createPythonWatcher();
            const events: PythonWorkspaceEnvEvent[] = [];
            watcher.onDidWorkspaceEnvChanged((e) => events.push(e));
            watcher.watchWorkspace(folder);
            watchers.find((w) => w.pattern === '**')?.created.fire(Uri.file(created));
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            watcher.dispose();
            return events;
        }

        test('reports the env executable inside it as created', async () => {
            const venvDir = path.join(root, '.venv');
            fs.mkdirSync(path.join(venvDir, path.dirname(executable)), { recursive: true });
            fs.writeFileSync(path.join(venvDir, executable), '');

            const events = await eventsAfterCreate(venvDir, 100);

            assert.deepStrictEqual(
                events.map((e) => ({ type: e.type, executable: e.executable })),
                [{ type: FileChangeType.Created, executable: path.join(venvDir, executable) }],
            );
        });

        test('waits for the executable of an env still being written', async () => {
            const venvDir = path.join(root, '.venv');
            fs.mkdirSync(venvDir);
            fs.writeFileSync(path.join(venvDir, 'pyvenv.cfg'), '');
            setTimeout(() => {
                fs.mkdirSync(path.join(venvDir, path.dirname(executable)), { recursive: true });
                fs.writeFileSync(path.join(venvDir, executable), '');
            }, 300);

            const events = await eventsAfterCreate(venvDir, 800);

            assert.deepStrictEqual(
                events.map((e) => ({ type: e.type, executable: e.executable })),
                [{ type: FileChangeType.Created, executable: path.join(venvDir, executable) }],
            );
        });

        test('reports nothing for a folder that is not an env', async () => {
            const dataDir = path.join(root, 'data');
            fs.mkdirSync(dataDir);
            // An executable added later is not waited for; the `**/python` watcher sees it.
            setTimeout(() => {
                fs.mkdirSync(path.join(dataDir, path.dirname(executable)), { recursive: true });
                fs.writeFileSync(path.join(dataDir, executable), '');
            }, 100);

            const events = await eventsAfterCreate(dataDir, 500);

            assert.deepStrictEqual(events, []);
        });
    });
});
