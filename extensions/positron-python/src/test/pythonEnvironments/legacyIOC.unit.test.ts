// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as assert from 'assert';
import * as TypeMoq from 'typemoq';
import { anything, when } from 'ts-mockito';
import { EventEmitter, Uri, WorkspaceFolder } from 'vscode';
import { FileChangeType } from '../../client/common/platform/fileSystemWatcher';
import { IComponentAdapter } from '../../client/interpreter/contracts';
import { IServiceManager } from '../../client/ioc/types';
import { PythonEnvKind } from '../../client/pythonEnvironments/base/info';
import { IDiscoveryAPI } from '../../client/pythonEnvironments/base/locator';
import { PythonEnvCollectionChangedEvent } from '../../client/pythonEnvironments/base/watcher';
import { registerNewDiscoveryForIOC } from '../../client/pythonEnvironments/legacyIOC';
import { mockedVSCodeNamespaces } from '../vscode-mock';

type FakeChangedEvent = PythonEnvCollectionChangedEvent & { envPath?: string };

suite('Component Adapter - onDidCreate', () => {
    const workspaceUri = Uri.file('/workspace');
    const workspaceFolder: WorkspaceFolder = { uri: workspaceUri, name: 'workspace', index: 0 };
    const resource = Uri.file('/workspace/some-file.py');

    let onChangedEmitter: EventEmitter<FakeChangedEvent>;
    let adapter: IComponentAdapter;

    setup(() => {
        onChangedEmitter = new EventEmitter<FakeChangedEvent>();

        const discoveryApi = TypeMoq.Mock.ofType<IDiscoveryAPI>();
        discoveryApi.setup((a) => a.onChanged).returns(() => onChangedEmitter.event);

        const serviceManager = TypeMoq.Mock.ofType<IServiceManager>();
        serviceManager.setup((s) => s.addSingleton(TypeMoq.It.isAny(), TypeMoq.It.isAny())).returns(() => undefined);
        serviceManager
            .setup((s) => s.addSingletonInstance(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .callback((_symbol: unknown, instance: unknown) => {
                adapter = instance as IComponentAdapter;
            });

        registerNewDiscoveryForIOC(serviceManager.object, discoveryApi.object);

        when(mockedVSCodeNamespaces.workspace!.getWorkspaceFolder(anything())).thenReturn(workspaceFolder);
    });

    teardown(() => {
        onChangedEmitter.dispose();
    });

    test('js locator shape: callback receives envPath', () => {
        const received: string[] = [];
        adapter.onDidCreate(resource, (envPath) => received.push(envPath));

        onChangedEmitter.fire({
            type: FileChangeType.Created,
            searchLocation: workspaceUri,
            envPath: `${workspaceUri.fsPath}/.venv/bin/python`,
        });

        assert.deepStrictEqual(received, [`${workspaceUri.fsPath}/.venv/bin/python`]);
    });

    test('native locator shape: callback receives new.executable.filename', () => {
        const received: string[] = [];
        adapter.onDidCreate(resource, (envPath) => received.push(envPath));

        onChangedEmitter.fire({
            type: FileChangeType.Created,
            searchLocation: workspaceUri,
            new: {
                executable: {
                    filename: `${workspaceUri.fsPath}/.venv/bin/python`,
                    sysPrefix: '',
                    ctime: -1,
                    mtime: -1,
                },
                kind: PythonEnvKind.Venv,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
        });

        assert.deepStrictEqual(received, [`${workspaceUri.fsPath}/.venv/bin/python`]);
    });

    test('Created event with no searchLocation (cold-start native discovery): no callback', () => {
        const received: string[] = [];
        adapter.onDidCreate(resource, (envPath) => received.push(envPath));

        onChangedEmitter.fire({
            type: FileChangeType.Created,
            envPath: `${workspaceUri.fsPath}/.venv/bin/python`,
        });

        assert.deepStrictEqual(received, []);
    });

    test('Created event with searchLocation outside the workspace: no callback', () => {
        const received: string[] = [];
        adapter.onDidCreate(resource, (envPath) => received.push(envPath));

        onChangedEmitter.fire({
            type: FileChangeType.Created,
            searchLocation: Uri.file('/somewhere/else'),
            envPath: '/somewhere/else/.venv/bin/python',
        });

        assert.deepStrictEqual(received, []);
    });

    [FileChangeType.Changed, FileChangeType.Deleted].forEach((type) => {
        test(`${type} event: no callback`, () => {
            const received: string[] = [];
            adapter.onDidCreate(resource, (envPath) => received.push(envPath));

            onChangedEmitter.fire({
                type,
                searchLocation: workspaceUri,
                envPath: `${workspaceUri.fsPath}/.venv/bin/python`,
            });

            assert.deepStrictEqual(received, []);
        });
    });
});
