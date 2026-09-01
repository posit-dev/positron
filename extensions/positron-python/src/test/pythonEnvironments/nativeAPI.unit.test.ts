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
import * as externalDeps from '../../client/pythonEnvironments/common/externalDependencies';
import * as nativeFinder from '../../client/pythonEnvironments/base/locators/common/nativePythonFinder';
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
    let isUvManagedBasePythonStub: sinon.SinonStub;
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
        isUvManagedBasePythonStub = sinon.stub(uvApi, 'isUvManagedBasePython');
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
    test('uv-managed base Python classified as global during addEnv via triggerRefresh', async () => {
        // A uv-managed standalone Python install lives under the uv python dir. It is a base
        // interpreter, not a dedicated environment, so it must be classified as global.
        const uvBasePython: NativeEnvInfo = {
            displayName: 'uv environment',
            name: 'my_uv_env',
            executable: '/home/user/.local/share/uv/python/cpython-3.11.5/bin/python',
            kind: NativePythonEnvironmentKind.VirtualEnv, // Initially detected as VirtualEnv
            version: '3.11.5',
            prefix: '/home/user/.local/share/uv/python/cpython-3.11.5',
        };

        isUvManagedBasePythonStub.withArgs(uvBasePython.executable).resolves(true);
        // addEnv awaits getAdditionalEnvDirs (which spawns uv); stub it for a hermetic test.
        sinon.stub(nativeFinder, 'getAdditionalEnvDirs').resolves([]);

        // Setup the finder to return our test env during refresh
        mockFinder
            .setup((f) => f.refresh())
            .returns(() => {
                async function* generator() {
                    yield* [uvBasePython];
                }
                return generator();
            })
            .verifiable(typemoq.Times.once());

        // Trigger refresh which will call addEnv internally
        await api.triggerRefresh();

        // Get the environments and verify the base Python was classified as global
        const envs = api.getEnvs();
        assert.equal(envs.length, 1);

        const addedEnv = envs[0];
        assert.isDefined(addedEnv);
        assert.equal(addedEnv.kind, PythonEnvKind.OtherGlobal);
        assert.equal(addedEnv.executable.filename, '/home/user/.local/share/uv/python/cpython-3.11.5/bin/python');

        // The base-vs-venv discriminator short-circuits before isUvEnvironment.
        assert.isTrue(
            isUvManagedBasePythonStub.calledWith('/home/user/.local/share/uv/python/cpython-3.11.5/bin/python'),
        );
    });

    test('uv-managed base Python classified as global during resolveEnv', async () => {
        const uvBasePython: NativeEnvInfo = {
            displayName: 'uv Python',
            name: 'uv_python',
            executable: '/home/user/.local/share/uv/python/cpython-3.10',
            kind: NativePythonEnvironmentKind.VirtualEnv, // Initially recognized as VirtualEnv
            version: '3.10.16',
            prefix: '/home/user/.local/share/uv/python',
        };

        isUvManagedBasePythonStub.withArgs(uvBasePython.executable).resolves(true);
        // addEnv awaits getAdditionalEnvDirs (which spawns uv); stub it for a hermetic test.
        sinon.stub(nativeFinder, 'getAdditionalEnvDirs').resolves([]);

        // Setup the finder to return our test env when resolving
        mockFinder
            .setup((f) => f.resolve('/home/user/.local/share/uv/python/cpython-3.10'))
            .returns(() => Promise.resolve(uvBasePython))
            .verifiable(typemoq.Times.once());

        // Resolve the environment
        const resolved = await api.resolveEnv('/home/user/.local/share/uv/python/cpython-3.10');

        // Verify the base Python was classified as global
        assert.isDefined(resolved);
        assert.equal(resolved?.kind, PythonEnvKind.OtherGlobal);

        // The classifier is consulted for this path during resolution.
        assert.isTrue(isUvManagedBasePythonStub.calledWith('/home/user/.local/share/uv/python/cpython-3.10'));
    });

    test('uv venv kept as Uv during addEnv via triggerRefresh', async () => {
        // A uv-created venv is a uv environment but not a standalone base install, so it stays
        // classified as Uv (a dedicated environment).
        const uvVenv: NativeEnvInfo = {
            displayName: 'uv venv',
            name: 'my_project',
            executable: '/home/user/projects/my_project/.venv/bin/python',
            kind: NativePythonEnvironmentKind.VirtualEnv,
            version: '3.12.1',
            prefix: '/home/user/projects/my_project/.venv',
        };

        isUvManagedBasePythonStub.withArgs(uvVenv.executable).resolves(false);
        isUvEnvironmentStub.withArgs(uvVenv.executable).resolves(true);
        // addEnv awaits getAdditionalEnvDirs (which spawns uv); stub it for a hermetic test.
        sinon.stub(nativeFinder, 'getAdditionalEnvDirs').resolves([]);

        mockFinder
            .setup((f) => f.refresh())
            .returns(() => {
                async function* generator() {
                    yield* [uvVenv];
                }
                return generator();
            })
            .verifiable(typemoq.Times.once());

        await api.triggerRefresh();

        const envs = api.getEnvs();
        assert.equal(envs.length, 1);
        assert.equal(envs[0]?.kind, PythonEnvKind.Uv);
        assert.isTrue(isUvEnvironmentStub.calledWith('/home/user/projects/my_project/.venv/bin/python'));
    });

    test('Pre-release version (alpha) is included in display name', async () => {
        // Create a test environment with an alpha version (e.g., Python 3.14.0a5)
        const alphaEnv: NativeEnvInfo = {
            displayName: 'Alpha Python',
            name: 'alpha_python',
            executable: '/usr/bin/python3.14',
            kind: NativePythonEnvironmentKind.LinuxGlobal,
            version: '3.14.0a5', // Alpha version
            prefix: '/usr/bin',
        };

        mockFinder
            .setup((f) => f.refresh())
            .returns(() => {
                async function* generator() {
                    yield* [alphaEnv];
                }
                return generator();
            })
            .verifiable(typemoq.Times.once());

        mockFinder.setup((f) => f.resolve(typemoq.It.isAny())).verifiable(typemoq.Times.never());

        await api.triggerRefresh();
        const envs = api.getEnvs();
        assert.equal(envs.length, 1);

        const addedEnv = envs[0];
        assert.isDefined(addedEnv);
        // Verify that the display name includes the alpha suffix
        assert.include(addedEnv.display ?? '', '3.14.0a5');
        assert.include(addedEnv.detailedDisplayName ?? '', '3.14.0a5');
        // Verify version info
        assert.equal(addedEnv.version.major, 3);
        assert.equal(addedEnv.version.minor, 14);
        assert.equal(addedEnv.version.micro, 0);
        assert.isDefined(addedEnv.version.release);
        assert.equal(addedEnv.version.release?.level, 'alpha');
        assert.equal(addedEnv.version.release?.serial, 5);
    });

    // --- Start Positron ---
    test('Additional global path (/opt/python) is classified as global during addEnv via triggerRefresh', async () => {
        if (process.platform === 'win32') {
            return;
        }

        const optPythonEnv: NativeEnvInfo = {
            displayName: 'Opt Python',
            name: 'python',
            executable: '/opt/python/3.12.0/bin/python',
            kind: undefined, // Initially unknown, should be upgraded to GlobalPaths
            version: '3.12.0',
            prefix: '/opt/python/3.12.0',
        };

        sinon.stub(nativeFinder, 'getAdditionalEnvDirs').resolves(['/opt/python']);

        mockFinder
            .setup((f) => f.refresh())
            .returns(() => {
                async function* generator() {
                    yield* [optPythonEnv];
                }
                return generator();
            })
            .verifiable(typemoq.Times.once());

        await api.triggerRefresh();

        const envs = api.getEnvs();
        assert.equal(envs.length, 1);

        const addedEnv = envs[0];
        assert.isDefined(addedEnv);
        assert.equal(addedEnv.executable.filename, '/opt/python/3.12.0/bin/python');
        assert.equal(addedEnv.kind, PythonEnvKind.OtherGlobal);
    });

    test('Additional global path (/opt/python) is classified as global during resolveEnv', async () => {
        if (process.platform === 'win32') {
            return;
        }

        const optPythonEnv: NativeEnvInfo = {
            displayName: 'Opt Python',
            name: 'python',
            executable: '/opt/python/3.12.0/bin/python',
            kind: undefined, // Initially unknown, should be upgraded to GlobalPaths
            version: '3.12.0',
            prefix: '/opt/python/3.12.0',
        };

        sinon.stub(nativeFinder, 'getAdditionalEnvDirs').resolves(['/opt/python']);

        mockFinder
            .setup((f) => f.resolve('/opt/python/3.12.0/bin/python'))
            .returns(() => Promise.resolve(optPythonEnv))
            .verifiable(typemoq.Times.once());

        const resolved = await api.resolveEnv('/opt/python/3.12.0/bin/python');

        assert.isDefined(resolved);
        assert.equal(resolved?.executable.filename, '/opt/python/3.12.0/bin/python');
        assert.equal(resolved?.kind, PythonEnvKind.OtherGlobal);
    });
    // --- End Positron ---

    test('ReplaceExistingEnv: shorter-path equivalent env replaces the longer one', async () => {
        // Two interpreters in an additional env dir that symlink to the same target.
        // The shorter path should replace the longer one (not be added alongside it).
        const additionalDir = '/opt/python';
        const longerPath = '/opt/python/3.10/bin/python3.10';
        const shorterPath = '/opt/python/3.10/bin/python';
        const symlinkTarget = '/opt/python/3.10/bin/python3.10';

        sinon.stub(nativeFinder, 'getAdditionalEnvDirs').resolves([additionalDir]);
        // Both executables canonicalize to the same underlying binary, and both
        // report the same install prefix, so they are the same environment.
        const resolveToTarget = async (p: string) => (p === longerPath || p === shorterPath ? symlinkTarget : p);
        sinon.stub(externalDeps, 'resolveSymbolicLink').callsFake(resolveToTarget);
        sinon.stub(externalDeps, 'canonicalizePath').callsFake(resolveToTarget);

        const longerEnv: NativeEnvInfo = {
            displayName: 'Python 3.10',
            name: 'python3.10',
            executable: longerPath,
            kind: NativePythonEnvironmentKind.LinuxGlobal,
            version: '3.10.0',
            prefix: '/opt/python/3.10',
        };
        const shorterEnv: NativeEnvInfo = {
            displayName: 'Python',
            name: 'python',
            executable: shorterPath,
            kind: NativePythonEnvironmentKind.LinuxGlobal,
            version: '3.10.0',
            prefix: '/opt/python/3.10',
        };

        // Yield the longer-path env first, then the shorter-path equivalent.
        // The shorter one should trigger ReplaceExistingEnv and evict the longer one.
        mockFinder
            .setup((f) => f.refresh())
            .returns(() => {
                async function* generator() {
                    yield* [longerEnv, shorterEnv];
                }
                return generator();
            })
            .verifiable(typemoq.Times.once());

        await api.triggerRefresh();

        const envs = api.getEnvs();
        assert.equal(envs.length, 1, 'expected exactly one env (longer path should be replaced)');
        assert.equal(envs[0].executable.filename, shorterPath);
    });

    test('a de-duplicated env that disappears is not kept alive by its longer equivalent', async () => {
        // The winning (shortest) path is deleted from disk, so the refresh only
        // reports the longer equivalent. Refresh bookkeeping tracks which paths
        // the refresh actually reported, so the stale winner must still be
        // removed rather than being re-confirmed by its equivalent.
        const additionalDir = '/opt/python';
        const shorterPath = '/opt/python/bin/python';
        const longerPath = '/opt/python/3.11/bin/python';
        const symlinkTarget = '/opt/python/3.11/bin/python3.11';

        sinon.stub(nativeFinder, 'getAdditionalEnvDirs').resolves([additionalDir]);
        const toTarget = async (p: string) =>
            p === shorterPath || p === longerPath || p === symlinkTarget ? symlinkTarget : p;
        sinon.stub(externalDeps, 'resolveSymbolicLink').callsFake(toTarget);
        sinon.stub(externalDeps, 'canonicalizePath').callsFake(toTarget);

        function envAt(executable: string): NativeEnvInfo {
            return {
                displayName: 'Python 3.11',
                name: 'python',
                executable,
                kind: NativePythonEnvironmentKind.LinuxGlobal,
                version: '3.11.13',
                prefix: '/opt/python/3.11',
            };
        }

        let shorterExists = true;
        mockFinder
            .setup((f) => f.refresh())
            .returns(() => {
                async function* generator() {
                    yield* shorterExists ? [envAt(shorterPath), envAt(longerPath)] : [envAt(longerPath)];
                }
                return generator();
            });

        await api.triggerRefresh();
        assert.deepEqual(
            api.getEnvs().map((e) => e.executable.filename),
            [shorterPath],
            'the shorter path should win the first refresh',
        );

        // The shorter path is deleted, so the next refresh only reports the longer one.
        shorterExists = false;
        await api.triggerRefresh();
        assert.notInclude(
            api.getEnvs().map((e) => e.executable.filename),
            shorterPath,
            'the deleted path must not survive because its equivalent was reported',
        );

        // The surviving path is picked up once the stale winner is gone.
        await api.triggerRefresh();
        assert.deepEqual(
            api.getEnvs().map((e) => e.executable.filename),
            [longerPath],
            'the remaining path should be discovered',
        );
    });

    suite('equal-length equivalent paths', () => {
        // Two interpreter paths of the same length that reach the same
        // interpreter, as on a Workbench image that carries both a versioned
        // directory and a `default` symlink beside it. `default` and `3.11.13`
        // are both 7 characters, so neither path is shorter.
        const additionalDir = '/opt/python';
        const defaultPath = '/opt/python/default/bin/python';
        const versionPath = '/opt/python/3.11.13/bin/python';
        const symlinkTarget = '/opt/python/3.11.13/bin/python3.11';

        function envAt(executable: string): NativeEnvInfo {
            return {
                displayName: 'Python 3.11',
                name: 'python',
                executable,
                kind: NativePythonEnvironmentKind.LinuxGlobal,
                version: '3.11.13',
                prefix: '/opt/python/3.11.13',
            };
        }

        setup(() => {
            assert.equal(defaultPath.length, versionPath.length, 'test premise: the two paths tie on length');
            sinon.stub(nativeFinder, 'getAdditionalEnvDirs').resolves([additionalDir]);
            const toTarget = async (p: string) =>
                p === defaultPath || p === versionPath || p === symlinkTarget ? symlinkTarget : p;
            sinon.stub(externalDeps, 'resolveSymbolicLink').callsFake(toTarget);
            sinon.stub(externalDeps, 'canonicalizePath').callsFake(toTarget);
        });

        test('a tie keeps one env and picks the same winner regardless of arrival order', async () => {
            // Whichever path arrives second must not displace the first, or each
            // arrival fires a path-changing event that forces another resolve,
            // and the two paths resolve each other forever.
            async function envsAfterRefreshOrder(order: NativeEnvInfo[]): Promise<string[]> {
                const finder = typemoq.Mock.ofType<NativePythonFinder>();
                finder
                    .setup((f) => f.refresh())
                    .returns(() => {
                        async function* generator() {
                            yield* order;
                        }
                        return generator();
                    });
                const scoped = nativeAPI.createNativeEnvironmentsApi(finder.object);
                await scoped.triggerRefresh();
                return scoped.getEnvs().map((e) => e.executable.filename);
            }

            const defaultFirst = await envsAfterRefreshOrder([envAt(defaultPath), envAt(versionPath)]);
            const versionFirst = await envsAfterRefreshOrder([envAt(versionPath), envAt(defaultPath)]);

            assert.equal(defaultFirst.length, 1, 'equivalent envs should collapse to one');
            assert.equal(versionFirst.length, 1, 'equivalent envs should collapse to one');
            assert.deepEqual(defaultFirst, versionFirst, 'the winner must not depend on arrival order');
        });

        test('resolving the losing path returns the surviving env', async () => {
            // The losing path still names a real interpreter. Returning nothing
            // leaves it uncacheable (only successes are cached) and unregisterable.
            mockFinder
                .setup((f) => f.refresh())
                .returns(() => {
                    async function* generator() {
                        yield* [envAt(versionPath), envAt(defaultPath)];
                    }
                    return generator();
                });

            await api.triggerRefresh();
            const survivor = api.getEnvs()[0].executable.filename;
            const loser = survivor === defaultPath ? versionPath : defaultPath;

            let resolveCount = 0;
            mockFinder
                .setup((f) => f.resolve(loser))
                .returns(() => {
                    resolveCount += 1;
                    return Promise.resolve(envAt(loser));
                });

            const resolved = await api.resolveEnv(loser);
            assert.isDefined(resolved, 'the losing path should resolve to the surviving env');
            assert.equal(resolved?.executable.filename, survivor);

            // And the result is cached under the losing path, so repeated calls
            // don't spawn PET again.
            await api.resolveEnv(loser);
            assert.equal(resolveCount, 1, 'the losing path should be cached after the first resolve');
        });
    });

    suite('three equal-length paths', () => {
        // Three interpreter paths that all tie on length, where only some of them
        // are equivalent: `/opt/python` holds two real versioned installs plus
        // `default`, a symlink to one of them. `3.11.11`, `3.11.13`, `current` and
        // `default` are all 7 characters, so no path is ever shorter than another
        // and every comparison between them is a tie.
        const additionalDir = '/opt/python';
        const olderPath = '/opt/python/3.11.11/bin/python';
        const newerPath = '/opt/python/3.11.13/bin/python';
        const defaultPath = '/opt/python/default/bin/python';
        const currentPath = '/opt/python/current/bin/python';

        // `default` and `current` both point at the 3.11.13 install; `3.11.11` is
        // its own interpreter. Directories are resolved as well as executables, so
        // an alias reached through a symlinked *directory* canonicalizes too.
        const aliasDirs = ['/opt/python/default', '/opt/python/current'];
        async function canonicalize(p: string): Promise<string> {
            let resolved = p;
            for (const aliasDir of aliasDirs) {
                if (p === aliasDir || p.startsWith(`${aliasDir}/`)) {
                    resolved = p.replace(aliasDir, '/opt/python/3.11.13');
                    break;
                }
            }
            return resolved.endsWith('/bin/python') ? `${resolved}3.11` : resolved;
        }

        function envAt(executable: string, version = '3.11.13'): NativeEnvInfo {
            return {
                displayName: `Python ${version}`,
                name: 'python',
                executable,
                kind: NativePythonEnvironmentKind.LinuxGlobal,
                version,
                // PET reports the prefix as the path it walked, alias and all.
                prefix: path.dirname(path.dirname(executable)),
            };
        }

        async function envsAfterRefreshOrder(order: NativeEnvInfo[]): Promise<string[]> {
            const finder = typemoq.Mock.ofType<NativePythonFinder>();
            finder
                .setup((f) => f.refresh())
                .returns(() => {
                    async function* generator() {
                        yield* order;
                    }
                    return generator();
                });
            const scoped = nativeAPI.createNativeEnvironmentsApi(finder.object);
            await scoped.triggerRefresh();
            return scoped
                .getEnvs()
                .map((e) => e.executable.filename)
                .sort();
        }

        /** Every arrival order of the given envs. */
        function permutations(envs: NativeEnvInfo[]): NativeEnvInfo[][] {
            if (envs.length <= 1) {
                return [envs];
            }
            const result: NativeEnvInfo[][] = [];
            for (let i = 0; i < envs.length; i += 1) {
                const rest = [...envs.slice(0, i), ...envs.slice(i + 1)];
                for (const tail of permutations(rest)) {
                    result.push([envs[i], ...tail]);
                }
            }
            return result;
        }

        setup(() => {
            for (const p of [olderPath, newerPath, defaultPath, currentPath]) {
                assert.equal(p.length, newerPath.length, 'test premise: all four paths tie on length');
            }
            sinon.stub(nativeFinder, 'getAdditionalEnvDirs').resolves([additionalDir]);
            sinon.stub(externalDeps, 'resolveSymbolicLink').callsFake(canonicalize);
            sinon.stub(externalDeps, 'canonicalizePath').callsFake(canonicalize);
        });

        test('a distinct interpreter is not dropped by a tie between two others', async () => {
            // Issue reported on PR #15635: with `3.11.11`, `3.11.13` and a
            // same-length `default` symlinked to `3.11.13`, only the alias may be
            // de-duplicated. `3.11.11` ties on length but is a different
            // interpreter, so it must survive in every arrival order.
            const envs = [envAt(olderPath, '3.11.11'), envAt(newerPath), envAt(defaultPath)];
            for (const order of permutations(envs)) {
                const filenames = await envsAfterRefreshOrder(order);
                assert.deepEqual(
                    filenames,
                    [olderPath, newerPath],
                    `both interpreters should survive, order: ${order.map((e) => e.executable).join(', ')}`,
                );
            }
        });

        test('a three-way tie collapses to one env regardless of arrival order', async () => {
            // All three paths reach the same interpreter and all three tie on
            // length, so the winner comes from the lexicographic tiebreak alone.
            // An order-dependent winner would let the paths displace each other
            // indefinitely.
            const envs = [envAt(newerPath), envAt(defaultPath), envAt(currentPath)];
            for (const order of permutations(envs)) {
                const filenames = await envsAfterRefreshOrder(order);
                assert.deepEqual(
                    filenames,
                    [newerPath],
                    `the tie should resolve to one winner, order: ${order.map((e) => e.executable).join(', ')}`,
                );
            }
        });
    });

    test('Issue #14489: a uv interpreter reached through a symlinked version directory is de-duplicated', async () => {
        // uv installs a real `cpython-3.14.6-*` directory alongside a
        // `cpython-3.14-*` symlink pointing at it. The ~/.local/bin shim reaches
        // the interpreter THROUGH the symlinked directory, so the executable file
        // itself is not a symlink and leaf-only resolution leaves the two paths
        // looking distinct. Full canonicalization resolves the directory symlink
        // and collapses them to the same real file.
        const realDir = '/home/user/.local/share/uv/python/cpython-3.14.6-linux-x86_64-gnu';
        const linkDir = '/home/user/.local/share/uv/python/cpython-3.14-linux-x86_64-gnu';
        const realExe = `${realDir}/bin/python`;
        const shimExe = '/home/user/.local/bin/python3.14';
        const canonicalExe = `${realDir}/bin/python3.14`;

        sinon
            .stub(nativeFinder, 'getAdditionalEnvDirs')
            .resolves(['/home/user/.local/share/uv/python', '/home/user/.local/bin']);
        // Leaf-only resolution (what the buggy code used) leaves the two distinct
        // because the shim's executable is not itself a symlink.
        sinon.stub(externalDeps, 'resolveSymbolicLink').callsFake(async (p: string) => {
            if (p === realExe) {
                return canonicalExe;
            }
            if (p === shimExe) {
                return `${linkDir}/bin/python3.14`;
            }
            return p;
        });
        // Full canonicalization resolves the directory symlink: both the executable
        // and the reported prefix collapse onto the real cpython-3.14.6 paths.
        sinon.stub(externalDeps, 'canonicalizePath').callsFake(async (p: string) => {
            if (p === realExe || p === shimExe) {
                return canonicalExe;
            }
            if (p === realDir || p === linkDir) {
                return realDir;
            }
            return p;
        });

        const realEnv: NativeEnvInfo = {
            displayName: 'Python 3.14.6',
            name: 'python',
            executable: realExe,
            kind: NativePythonEnvironmentKind.Uv,
            version: '3.14.6',
            prefix: realDir,
        };
        const shimEnv: NativeEnvInfo = {
            displayName: 'Python 3.14.6',
            name: 'python3.14',
            executable: shimExe,
            kind: NativePythonEnvironmentKind.Uv,
            version: '3.14.6',
            prefix: linkDir,
        };

        mockFinder
            .setup((f) => f.refresh())
            .returns(() => {
                async function* generator() {
                    yield* [realEnv, shimEnv];
                }
                return generator();
            });

        await api.triggerRefresh();

        const envs = api.getEnvs();
        assert.equal(envs.length, 1, 'the shim and the real interpreter should collapse to a single entry');
        // The shorter path (the ~/.local/bin shim) is the one kept.
        assert.equal(envs[0].executable.filename, shimExe);
    });

    test('Windows uv trampolines: a launcher that is not a symlink is de-duplicated via PET symlinks', async () => {
        // On Windows, uv installs `~/.local/bin/python.exe` as a trampoline: a
        // small regular executable (not a symlink) that spawns the real
        // interpreter, so canonicalizing it is a no-op. PET spawns the launcher
        // and reports the interpreter's real executable in `symlinks`, and its
        // prefix through uv's minor-version alias directory (a real directory
        // symlink). The identity must follow the in-prefix symlink so the
        // trampoline collapses into the real interpreter.
        const realDir = '/home/user/.local/share/uv/python/cpython-3.14.6-linux-x86_64-gnu';
        const linkDir = '/home/user/.local/share/uv/python/cpython-3.14-linux-x86_64-gnu';
        const realExe = `${realDir}/bin/python`;
        const aliasExe = `${linkDir}/bin/python`;
        const trampolineExe = '/home/user/.local/bin/python';

        sinon
            .stub(nativeFinder, 'getAdditionalEnvDirs')
            .resolves(['/home/user/.local/share/uv/python', '/home/user/.local/bin']);
        // The trampoline is a regular file: canonicalization leaves it as is.
        // Only the alias directory (and paths through it) resolve to the real dir.
        sinon.stub(externalDeps, 'canonicalizePath').callsFake(async (p: string) => {
            if (p === aliasExe) {
                return realExe;
            }
            if (p === linkDir) {
                return realDir;
            }
            return p;
        });

        const realEnv: NativeEnvInfo = {
            displayName: 'Python 3.14.6',
            name: 'python',
            executable: realExe,
            kind: NativePythonEnvironmentKind.Uv,
            version: '3.14.6',
            prefix: realDir,
        };
        const trampolineEnv: NativeEnvInfo = {
            displayName: 'Python 3.14.6',
            name: 'python',
            executable: trampolineExe,
            kind: NativePythonEnvironmentKind.GlobalPaths,
            version: '3.14.6',
            prefix: linkDir,
            symlinks: [trampolineExe, aliasExe],
        };

        mockFinder
            .setup((f) => f.refresh())
            .returns(() => {
                async function* generator() {
                    yield* [realEnv, trampolineEnv];
                }
                return generator();
            });

        await api.triggerRefresh();

        const envs = api.getEnvs();
        assert.equal(envs.length, 1, 'the trampoline and the real interpreter should collapse to a single entry');
        // The shorter path (the ~/.local/bin trampoline) is the one kept.
        assert.equal(envs[0].executable.filename, trampolineExe);
    });

    test('Issue #14493: distinct virtual environments sharing a base interpreter are both kept', async () => {
        // Two uv venvs whose `python` symlinks both resolve to the SAME base
        // interpreter, but which are genuinely different environments (different
        // prefixes). They must not be de-duplicated against each other.
        const base = '/home/user/.local/share/uv/python/cpython-3.12.0-linux-x86_64-gnu/bin/python3.12';
        const venvA = '/home/user/venvs/a/.venv';
        const venvB = '/home/user/venvs/bbb/.venv';
        const exeA = `${venvA}/bin/python`;
        const exeB = `${venvB}/bin/python`;

        sinon.stub(nativeFinder, 'getAdditionalEnvDirs').resolves(['/home/user/venvs']);
        // Both venv executables resolve/canonicalize to the same base interpreter;
        // every other path (notably each venv's distinct prefix) maps to itself.
        const resolveBoth = async (p: string) => (p === exeA || p === exeB ? base : p);
        sinon.stub(externalDeps, 'resolveSymbolicLink').callsFake(resolveBoth);
        sinon.stub(externalDeps, 'canonicalizePath').callsFake(resolveBoth);

        const envA: NativeEnvInfo = {
            displayName: 'Python 3.12.0',
            name: 'a',
            executable: exeA,
            kind: NativePythonEnvironmentKind.Venv,
            version: '3.12.0',
            prefix: venvA,
        };
        const envB: NativeEnvInfo = {
            displayName: 'Python 3.12.0',
            name: 'bbb',
            executable: exeB,
            kind: NativePythonEnvironmentKind.Venv,
            version: '3.12.0',
            prefix: venvB,
        };

        mockFinder
            .setup((f) => f.refresh())
            .returns(() => {
                async function* generator() {
                    yield* [envA, envB];
                }
                return generator();
            });

        await api.triggerRefresh();

        const envs = api
            .getEnvs()
            .map((e) => e.executable.filename)
            .sort();
        assert.deepEqual(envs, [exeA, exeB], 'both venvs should appear despite sharing a base interpreter');
    });

    // Regression tests for issue #12500: `resolveEnv` must not pin an
    // `undefined` resolution for 30s when PET is still discovering the env.
    suite('resolveEnv caching', () => {
        const pythonPath = '/usr/bin/python';

        setup(() => {
            // basicEnv (path /usr/bin/python) is not under any additional env
            // dir, but checkForExistingEnv unconditionally awaits this list
            // when addEnv runs. Return [] so the test doesn't depend on the
            // real vscode-configuration lookups.
            sinon.stub(nativeFinder, 'getAdditionalEnvDirs').resolves([]);
        });

        test('does not cache undefined resolutions', async () => {
            let resolveCount = 0;
            mockFinder
                .setup((f) => f.resolve(pythonPath))
                // The typemoq setup types `resolve` as `Promise<NativeEnvInfo>`,
                // but the runtime path treats undefined as "not yet resolved",
                // which is exactly what we're regression-testing.
                .returns(() => {
                    resolveCount += 1;
                    return Promise.resolve(resolveCount === 1 ? (undefined as unknown as NativeEnvInfo) : basicEnv);
                });

            const first = await api.resolveEnv(pythonPath);
            assert.isUndefined(first, 'first call should reflect the undefined resolution');

            const second = await api.resolveEnv(pythonPath);
            assert.isDefined(second, 'second call should return the now-resolved env');
            assert.equal(second?.executable.filename, pythonPath);
            assert.equal(resolveCount, 2, 'finder.resolve should be called twice (undefined is not cached)');
        });

        test('caches successful resolutions under the executable path', async () => {
            let resolveCount = 0;
            mockFinder
                .setup((f) => f.resolve(pythonPath))
                .returns(() => {
                    resolveCount += 1;
                    return Promise.resolve(basicEnv);
                });

            const first = await api.resolveEnv(pythonPath);
            const second = await api.resolveEnv(pythonPath);
            assert.deepEqual(first, expectedBasicEnv);
            assert.deepEqual(second, expectedBasicEnv);
            assert.equal(resolveCount, 1, 'second call should hit the cache and skip finder.resolve');
        });

        test('triggerRefresh refreshes the resolveEnv cache entry (late uv classification)', async () => {
            let resolveCount = 0;
            mockFinder
                .setup((f) => f.resolve(pythonPath))
                .returns(() => {
                    resolveCount += 1;
                    return Promise.resolve(basicEnv);
                });
            mockFinder
                .setup((f) => f.refresh())
                .returns(() => {
                    async function* generator() {
                        yield* [basicEnv];
                    }
                    return generator();
                });

            // Warm the cache while isUvEnvironment returns falsy (default stub behavior).
            const warm = await api.resolveEnv(pythonPath);
            assert.equal(warm?.kind, PythonEnvKind.System);

            // Reclassify the same executable as uv before the next refresh.
            isUvEnvironmentStub.withArgs(pythonPath).resolves(true);
            await api.triggerRefresh();

            // triggerRefresh routes the env through addEnv, which overwrites the
            // cache entry with the uv-classified info. Next resolveEnv should see
            // the updated kind without spawning another finder.resolve.
            const refreshed = await api.resolveEnv(pythonPath);
            assert.equal(refreshed?.kind, PythonEnvKind.Uv);
            assert.equal(resolveCount, 1, 'cache update via addEnv should not trigger another finder.resolve');
        });

        test('removeEnv invalidates the resolveEnv cache', async () => {
            let resolveCount = 0;
            let yieldEnv = false;
            mockFinder
                .setup((f) => f.resolve(pythonPath))
                .returns(() => {
                    resolveCount += 1;
                    return Promise.resolve(basicEnv);
                });
            mockFinder
                .setup((f) => f.refresh())
                .returns(() => {
                    async function* generator() {
                        if (yieldEnv) {
                            yield* [basicEnv];
                        }
                    }
                    return generator();
                });

            // Warm the cache via resolveEnv; addEnv also pushes into _envs.
            await api.resolveEnv(pythonPath);
            assert.equal(resolveCount, 1);
            assert.equal(api.getEnvs().length, 1);

            // Refresh yields nothing, so basicEnv falls off _envs via removeEnv,
            // which must also drop the cache entry.
            yieldEnv = false;
            await api.triggerRefresh();
            assert.equal(api.getEnvs().length, 0);

            // With the cache cleared, the next resolveEnv must call finder.resolve again.
            await api.resolveEnv(pythonPath);
            assert.equal(resolveCount, 2, 'cache should be cleared by removeEnv');
        });

        test('concurrent resolveEnv calls share a single PET round-trip', async () => {
            let resolveCount = 0;
            mockFinder
                .setup((f) => f.resolve(pythonPath))
                .returns(() => {
                    resolveCount += 1;
                    return Promise.resolve(basicEnv);
                });

            // Fire two concurrent calls for the same path.
            const [first, second] = await Promise.all([api.resolveEnv(pythonPath), api.resolveEnv(pythonPath)]);
            assert.isDefined(first);
            assert.isDefined(second);
            assert.equal(first?.executable.filename, pythonPath);
            assert.equal(second?.executable.filename, pythonPath);
            assert.equal(resolveCount, 1, 'concurrent calls should share a single finder.resolve');
        });

        test('caches under the requested path when PET reports a different one', async () => {
            // PET reports its own canonical path, not the alias that was asked
            // about. Caching only under the reported path leaves the alias
            // missing the cache forever, so every call spawns PET again.
            const aliasPath = '/usr/bin/python3';
            let resolveCount = 0;
            mockFinder
                .setup((f) => f.resolve(aliasPath))
                .returns(() => {
                    resolveCount += 1;
                    return Promise.resolve(basicEnv);
                });

            const first = await api.resolveEnv(aliasPath);
            assert.equal(first?.executable.filename, pythonPath, 'should report the path PET returned');

            const second = await api.resolveEnv(aliasPath);
            assert.equal(second?.executable.filename, pythonPath);
            assert.equal(resolveCount, 1, 'second call for the alias should hit the cache');
        });

        test('removeEnv invalidates entries cached under an alias path', async () => {
            const aliasPath = '/usr/bin/python3';
            let resolveCount = 0;
            let yieldEnv = true;
            mockFinder
                .setup((f) => f.resolve(aliasPath))
                .returns(() => {
                    resolveCount += 1;
                    return Promise.resolve(basicEnv);
                });
            mockFinder
                .setup((f) => f.refresh())
                .returns(() => {
                    async function* generator() {
                        if (yieldEnv) {
                            yield* [basicEnv];
                        }
                    }
                    return generator();
                });

            await api.resolveEnv(aliasPath);
            assert.equal(resolveCount, 1);

            // The env disappears, so removeEnv must drop the alias entry too,
            // not just the one keyed by the reported path.
            yieldEnv = false;
            await api.triggerRefresh();
            assert.equal(api.getEnvs().length, 0);

            await api.resolveEnv(aliasPath);
            assert.equal(resolveCount, 2, 'alias cache entry should be cleared by removeEnv');
        });
    });
    // --- End Positron ---
});

// --- Start Positron ---
suite('partitionModuleEnvsByNative', () => {
    // Build a minimal PythonEnvInfo carrying just the executable path the
    // partitioner reads; the other fields are irrelevant to the matching logic.
    function envWith(filename: string): PythonEnvInfo {
        return {
            arch: Architecture.Unknown,
            id: filename,
            detailedDisplayName: filename,
            display: filename,
            distro: { org: '' },
            executable: { filename, sysPrefix: '', ctime: -1, mtime: -1 },
            kind: PythonEnvKind.Unknown,
            location: filename,
            source: [],
            name: '',
            type: undefined,
            version: { sysVersion: undefined, major: -1, minor: -1, micro: -1 },
        };
    }

    // Fake symlink resolver: returns the canonical target from the map, or the
    // path itself when it isn't a symlink.
    function resolverFrom(canonical: Record<string, string>): (p: string) => Promise<string> {
        return (p: string) => Promise.resolve(canonical[p] ?? p);
    }

    test('re-keys a module interpreter that resolves to the same target as a native env', async () => {
        // The native locator surfaces bin/python; the module locator resolves
        // python3 first (bin/python3). Both symlink to the same interpreter.
        const target = '/uv/cpython-3.11.14/bin/python3.11';
        const result = await nativeAPI.partitionModuleEnvsByNative(
            [envWith('/uv/cpython-3.11.14/bin/python3')],
            [envWith('/uv/cpython-3.11.14/bin/python')],
            resolverFrom({
                '/uv/cpython-3.11.14/bin/python': target,
                '/uv/cpython-3.11.14/bin/python3': target,
            }),
        );
        assert.deepEqual(
            { uniqueModuleEnvs: result.uniqueModuleEnvs.map((e) => e.executable.filename), reKeys: result.reKeys },
            {
                uniqueModuleEnvs: [],
                reKeys: [{ from: '/uv/cpython-3.11.14/bin/python3', to: '/uv/cpython-3.11.14/bin/python' }],
            },
        );
    });

    test('keeps a module interpreter that has no native equivalent', async () => {
        const result = await nativeAPI.partitionModuleEnvsByNative(
            [envWith('/opt/mod/bin/python3')],
            [envWith('/usr/bin/python')],
            resolverFrom({}),
        );
        assert.deepEqual(
            { uniqueModuleEnvs: result.uniqueModuleEnvs.map((e) => e.executable.filename), reKeys: result.reKeys },
            { uniqueModuleEnvs: ['/opt/mod/bin/python3'], reKeys: [] },
        );
    });

    test('drops a module interpreter whose path matches the native env without re-keying', async () => {
        const target = '/uv/cpython-3.11.14/bin/python3.11';
        const result = await nativeAPI.partitionModuleEnvsByNative(
            [envWith('/uv/cpython-3.11.14/bin/python3')],
            [envWith('/uv/cpython-3.11.14/bin/python3')],
            resolverFrom({ '/uv/cpython-3.11.14/bin/python3': target }),
        );
        assert.deepEqual(
            { uniqueModuleEnvs: result.uniqueModuleEnvs.map((e) => e.executable.filename), reKeys: result.reKeys },
            { uniqueModuleEnvs: [], reKeys: [] },
        );
    });

    test('returns module envs unchanged when there are no native envs', async () => {
        const result = await nativeAPI.partitionModuleEnvsByNative(
            [envWith('/opt/mod/bin/python3')],
            [],
            resolverFrom({}),
        );
        assert.deepEqual(
            { uniqueModuleEnvs: result.uniqueModuleEnvs.map((e) => e.executable.filename), reKeys: result.reKeys },
            { uniqueModuleEnvs: ['/opt/mod/bin/python3'], reKeys: [] },
        );
    });

    test('Issue #14493: distinct venvs sharing a base interpreter are not merged', async () => {
        // The module and native locators each surface a *different* venv, but both
        // venvs' `python` resolves to the same base interpreter. They are distinct
        // environments (different prefixes), so the module env must be kept, not
        // re-keyed onto the native one.
        const base = '/uv/cpython-3.12.0/bin/python3.12';
        const venvA = '/home/user/venvs/a/.venv';
        const venvB = '/home/user/venvs/bbb/.venv';
        const envWithPrefix = (filename: string, sysPrefix: string): PythonEnvInfo => ({
            ...envWith(filename),
            executable: { filename, sysPrefix, ctime: -1, mtime: -1 },
        });

        const result = await nativeAPI.partitionModuleEnvsByNative(
            [envWithPrefix(`${venvB}/bin/python`, venvB)],
            [envWithPrefix(`${venvA}/bin/python`, venvA)],
            (p) => Promise.resolve(p === `${venvA}/bin/python` || p === `${venvB}/bin/python` ? base : p),
        );
        assert.deepEqual(
            { uniqueModuleEnvs: result.uniqueModuleEnvs.map((e) => e.executable.filename), reKeys: result.reKeys },
            { uniqueModuleEnvs: [`${venvB}/bin/python`], reKeys: [] },
        );
    });

    test('a module env with no prefix still de-dups against its native twin', async () => {
        // In production the native locator fills in a real prefix (via PET) while
        // a module-discovered env has none (envWith leaves sysPrefix ''). The two
        // must still collapse to one entry: getEnvIdentity derives the missing
        // module prefix from the resolved executable's grandparent
        // (`<prefix>/bin/python`), which matches the native prefix.
        const prefix = '/opt/python/3.11';
        const nativeExe = `${prefix}/bin/python`;
        const moduleExe = `${prefix}/bin/python3`;
        const target = `${prefix}/bin/python3.11`;
        const nativeEnv: PythonEnvInfo = {
            ...envWith(nativeExe),
            executable: { filename: nativeExe, sysPrefix: prefix, ctime: -1, mtime: -1 },
        };

        const result = await nativeAPI.partitionModuleEnvsByNative([envWith(moduleExe)], [nativeEnv], (p) =>
            Promise.resolve(p === nativeExe || p === moduleExe ? target : p),
        );
        assert.deepEqual(
            { uniqueModuleEnvs: result.uniqueModuleEnvs.map((e) => e.executable.filename), reKeys: result.reKeys },
            { uniqueModuleEnvs: [], reKeys: [{ from: moduleExe, to: nativeExe }] },
        );
    });

    test('a module env reached through a ~/.local/bin shim de-dups against its native twin', async () => {
        // Module envs commonly resolve to a shim like ~/.local/bin/python3 that
        // points into the real install. Its own grandparent (~/.local/bin ->
        // ~/.local) is not the interpreter's prefix, so the identity must be
        // built from the RESOLVED executable's install dir -- which is the prefix
        // PET reports for the native env it discovered at the real location.
        const realPrefix = '/home/user/.local/share/uv/python/cpython-3.14.6-linux';
        const realExe = `${realPrefix}/bin/python3.14`;
        const shimExe = '/home/user/.local/bin/python3.14';
        const nativeEnv: PythonEnvInfo = {
            ...envWith(realExe),
            executable: { filename: realExe, sysPrefix: realPrefix, ctime: -1, mtime: -1 },
        };
        // realpath resolves both the shim and the real path to the same file.
        const canonicalize = (p: string) => Promise.resolve(p === shimExe || p === realExe ? realExe : p);

        const result = await nativeAPI.partitionModuleEnvsByNative([envWith(shimExe)], [nativeEnv], canonicalize);
        assert.deepEqual(
            { uniqueModuleEnvs: result.uniqueModuleEnvs.map((e) => e.executable.filename), reKeys: result.reKeys },
            { uniqueModuleEnvs: [], reKeys: [{ from: shimExe, to: realExe }] },
        );
    });
});
// --- End Positron ---
