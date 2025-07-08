// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable class-methods-use-this */

import { assert } from 'chai';
import * as path from 'path';
import * as typemoq from 'typemoq';
import * as sinon from 'sinon';
import * as nativeAPI from '../../client/pythonEnvironments/nativeAPI';
import { IDiscoveryAPI } from '../../client/pythonEnvironments/base/locator';
import {
    NativeEnvInfo,
    NativeEnvManagerInfo,
    NativePythonFinder,
} from '../../client/pythonEnvironments/base/locators/common/nativePythonFinder';
import { Architecture, getPathEnvVariable, isWindows } from '../../client/common/utils/platform';
import { PythonEnvInfo, PythonEnvKind, PythonEnvType } from '../../client/pythonEnvironments/base/info';
import { NativePythonEnvironmentKind } from '../../client/pythonEnvironments/base/locators/common/nativePythonUtils';
import * as condaApi from '../../client/pythonEnvironments/common/environmentManagers/conda';
import * as pyenvApi from '../../client/pythonEnvironments/common/environmentManagers/pyenv';
import * as pw from '../../client/pythonEnvironments/base/locators/common/pythonWatcher';
import * as ws from '../../client/common/vscodeApis/workspaceApis';

// --- Start Positron ---
import * as uvApi from '../../client/pythonEnvironments/common/environmentManagers/uv';
// --- End Positron ---

suite('Native Python API', () => {
    let api: IDiscoveryAPI;
    let mockFinder: typemoq.IMock<NativePythonFinder>;
    let setCondaBinaryStub: sinon.SinonStub;
    let getCondaPathSettingStub: sinon.SinonStub;
    let getCondaEnvDirsStub: sinon.SinonStub;
    let setPyEnvBinaryStub: sinon.SinonStub;
    let createPythonWatcherStub: sinon.SinonStub;
    let mockWatcher: typemoq.IMock<pw.PythonWatcher>;
    let getWorkspaceFoldersStub: sinon.SinonStub;
    // --- Start Positron ---
    let isUvEnvironmentStub: sinon.SinonStub;
    // --- End Positron ---

    const basicEnv: NativeEnvInfo = {
        displayName: 'Basic Python',
        name: 'basic_python',
        executable: '/usr/bin/python',
        kind: NativePythonEnvironmentKind.LinuxGlobal,
        version: `3.12.0`,
        prefix: '/usr/bin',
    };

    const basicEnv2: NativeEnvInfo = {
        displayName: 'Basic Python',
        name: 'basic_python',
        executable: '/usr/bin/python',
        kind: NativePythonEnvironmentKind.LinuxGlobal,
        version: undefined, // this is intentionally set to trigger resolve
        prefix: '/usr/bin',
    };

    const expectedBasicEnv: PythonEnvInfo = {
        arch: Architecture.Unknown,
        id: '/usr/bin/python',
        detailedDisplayName: 'Python 3.12.0 (basic_python)',
        display: 'Python 3.12.0 (basic_python)',
        distro: { org: '' },
        executable: { filename: '/usr/bin/python', sysPrefix: '/usr/bin', ctime: -1, mtime: -1 },
        kind: PythonEnvKind.System,
        location: '/usr/bin/python',
        source: [],
        name: 'basic_python',
        type: undefined,
        version: { sysVersion: '3.12.0', major: 3, minor: 12, micro: 0 },
    };

    const conda: NativeEnvInfo = {
        displayName: 'Conda Python',
        name: 'conda_python',
        executable: '/home/user/.conda/envs/conda_python/python',
        kind: NativePythonEnvironmentKind.Conda,
        version: `3.12.0`,
        prefix: '/home/user/.conda/envs/conda_python',
    };

    const conda1: NativeEnvInfo = {
        displayName: 'Conda Python',
        name: 'conda_python',
        executable: '/home/user/.conda/envs/conda_python/python',
        kind: NativePythonEnvironmentKind.Conda,
        version: undefined, // this is intentionally set to test conda without python
        prefix: '/home/user/.conda/envs/conda_python',
    };

    const conda2: NativeEnvInfo = {
        displayName: 'Conda Python',
        name: 'conda_python',
        executable: undefined, // this is intentionally set to test env with no executable
        kind: NativePythonEnvironmentKind.Conda,
        version: undefined, // this is intentionally set to test conda without python
        prefix: '/home/user/.conda/envs/conda_python',
    };

    const exePath = isWindows()
        ? path.join('/home/user/.conda/envs/conda_python', 'python.exe')
        : path.join('/home/user/.conda/envs/conda_python', 'python');

    const expectedConda1: PythonEnvInfo = {
        arch: Architecture.Unknown,
        detailedDisplayName: 'Python 3.12.0 (conda_python)',
        display: 'Python 3.12.0 (conda_python)',
        distro: { org: '' },
        id: '/home/user/.conda/envs/conda_python/python',
        executable: {
            filename: '/home/user/.conda/envs/conda_python/python',
            sysPrefix: '/home/user/.conda/envs/conda_python',
            ctime: -1,
            mtime: -1,
        },
        kind: PythonEnvKind.Conda,
        location: '/home/user/.conda/envs/conda_python',
        source: [],
        name: 'conda_python',
        type: PythonEnvType.Conda,
        version: { sysVersion: '3.12.0', major: 3, minor: 12, micro: 0 },
    };

    const expectedConda2: PythonEnvInfo = {
        arch: Architecture.Unknown,
        detailedDisplayName: 'Conda Python',
        display: 'Conda Python',
        distro: { org: '' },
        id: exePath,
        executable: {
            filename: exePath,
            sysPrefix: '/home/user/.conda/envs/conda_python',
            ctime: -1,
            mtime: -1,
        },
        kind: PythonEnvKind.Conda,
        location: '/home/user/.conda/envs/conda_python',
        source: [],
        name: 'conda_python',
        type: PythonEnvType.Conda,
        version: { sysVersion: undefined, major: -1, minor: -1, micro: -1 },
    };

    setup(() => {
        setCondaBinaryStub = sinon.stub(condaApi, 'setCondaBinary');
        getCondaEnvDirsStub = sinon.stub(condaApi, 'getCondaEnvDirs');
        getCondaPathSettingStub = sinon.stub(condaApi, 'getCondaPathSetting');
        setPyEnvBinaryStub = sinon.stub(pyenvApi, 'setPyEnvBinary');
        // --- Start Positron ---
        isUvEnvironmentStub = sinon.stub(uvApi, 'isUvEnvironment');
        // --- End Positron ---
        getWorkspaceFoldersStub = sinon.stub(ws, 'getWorkspaceFolders');
        getWorkspaceFoldersStub.returns([]);

        createPythonWatcherStub = sinon.stub(pw, 'createPythonWatcher');
        mockWatcher = typemoq.Mock.ofType<pw.PythonWatcher>();
        createPythonWatcherStub.returns(mockWatcher.object);

        mockWatcher.setup((w) => w.watchWorkspace(typemoq.It.isAny())).returns(() => undefined);
        mockWatcher.setup((w) => w.watchPath(typemoq.It.isAny(), typemoq.It.isAny())).returns(() => undefined);
        mockWatcher.setup((w) => w.unwatchWorkspace(typemoq.It.isAny())).returns(() => undefined);
        mockWatcher.setup((w) => w.unwatchPath(typemoq.It.isAny())).returns(() => undefined);

        mockFinder = typemoq.Mock.ofType<NativePythonFinder>();
        api = nativeAPI.createNativeEnvironmentsApi(mockFinder.object);
    });

    teardown(() => {
        sinon.restore();
    });

    test('Trigger refresh without resolve', async () => {
        mockFinder
            .setup((f) => f.refresh())
            .returns(() => {
                async function* generator() {
                    yield* [basicEnv];
                }
                return generator();
            })
            .verifiable(typemoq.Times.once());

        mockFinder.setup((f) => f.resolve(typemoq.It.isAny())).verifiable(typemoq.Times.never());

        await api.triggerRefresh();
        const actual = api.getEnvs();
        assert.deepEqual(actual, [expectedBasicEnv]);
    });

    test('Trigger refresh with resolve', async () => {
        mockFinder
            .setup((f) => f.refresh())
            .returns(() => {
                async function* generator() {
                    yield* [basicEnv2];
                }
                return generator();
            })
            .verifiable(typemoq.Times.once());

        mockFinder
            .setup((f) => f.resolve(typemoq.It.isAny()))
            .returns(() => Promise.resolve(basicEnv))
            .verifiable(typemoq.Times.once());

        api.triggerRefresh();
        await api.getRefreshPromise();

        const actual = api.getEnvs();
        assert.deepEqual(actual, [expectedBasicEnv]);
    });

    test('Trigger refresh and use refresh promise API', async () => {
        mockFinder
            .setup((f) => f.refresh())
            .returns(() => {
                async function* generator() {
                    yield* [basicEnv];
                }
                return generator();
            })
            .verifiable(typemoq.Times.once());

        mockFinder.setup((f) => f.resolve(typemoq.It.isAny())).verifiable(typemoq.Times.never());

        api.triggerRefresh();
        await api.getRefreshPromise();

        const actual = api.getEnvs();
        assert.deepEqual(actual, [expectedBasicEnv]);
    });

    test('Conda environment with resolve', async () => {
        mockFinder
            .setup((f) => f.refresh())
            .returns(() => {
                async function* generator() {
                    yield* [conda1];
                }
                return generator();
            })
            .verifiable(typemoq.Times.once());
        mockFinder
            .setup((f) => f.resolve(typemoq.It.isAny()))
            .returns(() => Promise.resolve(conda))
            .verifiable(typemoq.Times.once());

        await api.triggerRefresh();
        const actual = api.getEnvs();
        assert.deepEqual(actual, [expectedConda1]);
    });

    test('Ensure no duplication on resolve', async () => {
        mockFinder
            .setup((f) => f.refresh())
            .returns(() => {
                async function* generator() {
                    yield* [conda1];
                }
                return generator();
            })
            .verifiable(typemoq.Times.once());
        mockFinder
            .setup((f) => f.resolve(typemoq.It.isAny()))
            .returns(() => Promise.resolve(conda))
            .verifiable(typemoq.Times.once());

        await api.triggerRefresh();
        await api.resolveEnv('/home/user/.conda/envs/conda_python/python');
        const actual = api.getEnvs();
        assert.deepEqual(actual, [expectedConda1]);
    });

    test('Conda environment with no python', async () => {
        mockFinder
            .setup((f) => f.refresh())
            .returns(() => {
                async function* generator() {
                    yield* [conda2];
                }
                return generator();
            })
            .verifiable(typemoq.Times.once());
        mockFinder.setup((f) => f.resolve(typemoq.It.isAny())).verifiable(typemoq.Times.never());

        await api.triggerRefresh();
        const actual = api.getEnvs();
        assert.deepEqual(actual, [expectedConda2]);
    });

    test('Refresh promise undefined after refresh', async () => {
        mockFinder
            .setup((f) => f.refresh())
            .returns(() => {
                async function* generator() {
                    yield* [basicEnv];
                }
                return generator();
            })
            .verifiable(typemoq.Times.once());

        mockFinder.setup((f) => f.resolve(typemoq.It.isAny())).verifiable(typemoq.Times.never());

        await api.triggerRefresh();
        assert.isUndefined(api.getRefreshPromise());
    });

    test('Setting conda binary', async () => {
        getCondaPathSettingStub.returns(undefined);
        getCondaEnvDirsStub.resolves(undefined);
        const condaFakeDir = getPathEnvVariable()[0];
        const condaMgr: NativeEnvManagerInfo = {
            tool: 'Conda',
            executable: path.join(condaFakeDir, 'conda'),
        };
        mockFinder
            .setup((f) => f.refresh())
            .returns(() => {
                async function* generator() {
                    yield* [condaMgr];
                }
                return generator();
            })
            .verifiable(typemoq.Times.once());
        await api.triggerRefresh();
        assert.isTrue(setCondaBinaryStub.calledOnceWith(condaMgr.executable));
    });

    test('Setting pyenv binary', async () => {
        const pyenvMgr: NativeEnvManagerInfo = {
            tool: 'PyEnv',
            executable: '/usr/bin/pyenv',
        };
        mockFinder
            .setup((f) => f.refresh())
            .returns(() => {
                async function* generator() {
                    yield* [pyenvMgr];
                }
                return generator();
            })
            .verifiable(typemoq.Times.once());
        await api.triggerRefresh();
        assert.isTrue(setPyEnvBinaryStub.calledOnceWith(pyenvMgr.executable));
    });

    // --- Start Positron ---
    test('Uv environment detected and converted during addEnv via triggerRefresh', async () => {
        // Create a test environment that looks like a regular VirtualEnv initially
        const uvEnv: NativeEnvInfo = {
            displayName: 'UV Environment',
            name: 'my_uv_env',
            executable: '/home/user/.local/share/uv/python/cpython-3.11.5/bin/python',
            kind: NativePythonEnvironmentKind.VirtualEnv, // Initially detected as VirtualEnv
            version: '3.11.5',
            prefix: '/home/user/.local/share/uv/python/cpython-3.11.5',
        };

        // Mock isUvEnvironment to return true for this environment
        isUvEnvironmentStub.withArgs(uvEnv.executable).resolves(true);

        // Setup the finder to return our test env during refresh
        mockFinder
            .setup((f) => f.refresh())
            .returns(() => {
                async function* generator() {
                    yield* [uvEnv];
                }
                return generator();
            })
            .verifiable(typemoq.Times.once());

        // Trigger refresh which will call addEnv internally
        await api.triggerRefresh();

        // Get the environments and verify the uv environment was converted
        const envs = api.getEnvs();
        assert.equal(envs.length, 1);

        const addedEnv = envs[0];
        assert.isDefined(addedEnv);
        assert.equal(addedEnv.kind, PythonEnvKind.Uv);
        assert.equal(addedEnv.executable.filename, '/home/user/.local/share/uv/python/cpython-3.11.5/bin/python');

        // Verify isUvEnvironment was called during addEnv
        assert.isTrue(isUvEnvironmentStub.calledWith('/home/user/.local/share/uv/python/cpython-3.11.5/bin/python'));
    });

    test('Uv environment detected and converted during resolveEnv', async () => {
        // Create a test environment
        const uvEnv: NativeEnvInfo = {
            displayName: 'UV Python',
            name: 'uv_python',
            executable: '/home/user/.local/share/uv/python/cpython-3.10',
            kind: NativePythonEnvironmentKind.VirtualEnv, // Initially recognized as VirtualEnv
            version: '3.10.16',
            prefix: '/home/user/.local/share/uv/python',
        };

        // Mock the isUvEnvironment to return true for this environment
        isUvEnvironmentStub.withArgs(uvEnv.executable).resolves(true);

        // Setup the finder to return our test env when resolving
        mockFinder
            .setup((f) => f.resolve('/home/user/.local/share/uv/python/cpython-3.10'))
            .returns(() => Promise.resolve(uvEnv))
            .verifiable(typemoq.Times.once());

        // Resolve the environment
        const resolved = await api.resolveEnv('/home/user/.local/share/uv/python/cpython-3.10');

        // Verify the environment was recognized as Uv
        assert.isDefined(resolved);
        assert.equal(resolved?.kind, PythonEnvKind.Uv);

        // Verify isUvEnvironment was called twice (once when adding; once when resolving)
        assert.isTrue(isUvEnvironmentStub.calledTwice);
        assert.isTrue(isUvEnvironmentStub.calledWith('/home/user/.local/share/uv/python/cpython-3.10'));
    });
    // --- End Positron ---
});
