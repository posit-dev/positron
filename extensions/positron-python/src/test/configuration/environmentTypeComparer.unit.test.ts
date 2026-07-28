// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
// --- Start Positron ---
/* eslint-disable import/no-duplicates */
import { Uri } from 'vscode';
// --- End Positron ---

import * as assert from 'assert';
import * as path from 'path';
import * as sinon from 'sinon';
import { Architecture } from '../../client/common/utils/platform';
import {
    EnvironmentTypeComparer,
    EnvLocationHeuristic,
    getEnvLocationHeuristic,
    isProblematicCondaEnvironment,
} from '../../client/interpreter/configuration/environmentTypeComparer';
import { IInterpreterHelper } from '../../client/interpreter/contracts';
import { NativePythonEnvironmentKind } from '../../client/pythonEnvironments/base/locators/common/nativePythonUtils';
import * as pyenv from '../../client/pythonEnvironments/common/environmentManagers/pyenv';
import { EnvironmentType, PythonEnvironment } from '../../client/pythonEnvironments/info';
// --- Start Positron ---
import * as externalDependencies from '../../client/pythonEnvironments/common/externalDependencies';
import { getPyenvVersion } from '../../client/interpreter/configuration/environmentTypeComparer';
import * as pyenvUtils from '../../client/pythonEnvironments/common/environmentManagers/pyenv';
import * as workspaceApis from '../../client/common/vscodeApis/workspaceApis';
import * as interpreterSettings from '../../client/positron/interpreterSettings';
// --- End Positron ---

suite('Environment sorting', () => {
    const workspacePath = path.join('path', 'to', 'workspace');
    let interpreterHelper: IInterpreterHelper;
    let getActiveWorkspaceUriStub: sinon.SinonStub;
    let getInterpreterTypeDisplayNameStub: sinon.SinonStub;
    const preferredPyenv = path.join('path', 'to', 'preferred', 'pyenv');

    setup(() => {
        getActiveWorkspaceUriStub = sinon.stub().returns({ folderUri: { fsPath: workspacePath } });
        getInterpreterTypeDisplayNameStub = sinon.stub();

        interpreterHelper = {
            getActiveWorkspaceUri: getActiveWorkspaceUriStub,
            getInterpreterTypeDisplayName: getInterpreterTypeDisplayNameStub,
        } as unknown as IInterpreterHelper;
        const getActivePyenvForDirectory = sinon.stub(pyenv, 'getActivePyenvForDirectory');
        getActivePyenvForDirectory.resolves(preferredPyenv);
        // --- Start Positron ---
        // Test fixture paths don't exist on disk. Assume they do, so conda fixtures that aren't
        // specifically testing isProblematicCondaEnvironment aren't flagged as problematic.
        sinon.stub(externalDependencies, 'pathExistsSync').returns(true);
        // Categorization reads the open folders and the custom interpreter dirs from settings.
        sinon.stub(workspaceApis, 'getWorkspaceFolderPaths').returns([workspacePath]);
        sinon.stub(interpreterSettings, 'getCustomEnvDirs').returns([]);
        // --- End Positron ---
    });

    teardown(() => {
        sinon.restore();
    });

    type ComparisonTestCaseType = {
        title: string;
        envA: PythonEnvironment;
        envB: PythonEnvironment;
        expected: number;
    };

    const testcases: ComparisonTestCaseType[] = [
        {
            title: 'A project environment should come before a global environment',
            envA: {
                envType: EnvironmentType.Venv,
                nativeEnvKind: NativePythonEnvironmentKind.Venv,
                envPath: path.join(workspacePath, '.venv'),
                path: path.join(workspacePath, '.venv', 'bin', 'python'),
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Venv,
                nativeEnvKind: NativePythonEnvironmentKind.Venv,
                envPath: path.join('path', 'to', 'other', 'workspace', '.venv'),
                path: path.join('path', 'to', 'other', 'workspace', '.venv', 'bin', 'python'),
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: -1,
        },
        {
            title: 'A global environment should come before a base interpreter',
            envA: {
                envType: EnvironmentType.Conda,
                nativeEnvKind: NativePythonEnvironmentKind.Conda,
                envName: 'conda-env',
                path: path.join('home', 'user', 'miniconda3', 'envs', 'conda-env', 'bin', 'python'),
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Global,
                path: path.join('opt', 'python', 'bin', 'python3'),
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: -1,
        },
        {
            title: 'A base interpreter should come before an externally managed (system) interpreter',
            envA: {
                envType: EnvironmentType.Global,
                path: path.join('opt', 'python', 'bin', 'python3'),
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.System,
                path: '/usr/bin/python3',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: -1,
        },
        {
            title:
                'A conda base environment should be categorized as externally managed, ' +
                'behind a regular conda environment',
            envA: {
                envType: EnvironmentType.Conda,
                nativeEnvKind: NativePythonEnvironmentKind.Conda,
                envName: 'conda-env',
                path: path.join('home', 'user', 'miniconda3', 'envs', 'conda-env', 'bin', 'python'),
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Conda,
                nativeEnvKind: NativePythonEnvironmentKind.Conda,
                envName: 'base',
                path: path.join('home', 'user', 'miniconda3', 'bin', 'python'),
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: -1,
        },
        {
            title: 'Problematic environments should come last, ahead of category ranking',
            envA: {
                envType: EnvironmentType.Conda,
                envPath: path.join(workspacePath, '.venv'),
                path: 'python',
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.System,
                path: '/usr/bin/python3',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'Unsupported Python versions should come last, ahead of category ranking',
            envA: {
                envType: EnvironmentType.Venv,
                nativeEnvKind: NativePythonEnvironmentKind.Venv,
                envPath: path.join(workspacePath, '.venv'),
                path: path.join(workspacePath, '.venv', 'bin', 'python'),
                version: { major: 3, minor: 7, patch: 5, raw: '3.7.5' },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.System,
                path: '/usr/bin/python3',
                version: { major: 3, minor: 10, patch: 2, raw: '3.10.2' },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'Within the same category, the most recent Python version comes first',
            envA: {
                envType: EnvironmentType.Conda,
                nativeEnvKind: NativePythonEnvironmentKind.Conda,
                envName: 'conda-old',
                path: path.join('home', 'user', 'miniconda3', 'envs', 'conda-old', 'bin', 'python'),
                // Must stay >= MINIMUM_PYTHON_VERSION (3.9.0): an unsupported version would hit
                // the isVersionSupported guard before this test's own version tiebreak runs.
                version: { major: 3, minor: 9, patch: 5, raw: '3.9.5' },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Conda,
                nativeEnvKind: NativePythonEnvironmentKind.Conda,
                envName: 'conda-new',
                path: path.join('home', 'user', 'miniconda3', 'envs', 'conda-new', 'bin', 'python'),
                version: { major: 3, minor: 10, patch: 2, raw: '3.10.2' },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'Within the same category and version, environments are sorted by name',
            envA: {
                envType: EnvironmentType.Conda,
                nativeEnvKind: NativePythonEnvironmentKind.Conda,
                envName: 'conda-foo',
                path: path.join('home', 'user', 'miniconda3', 'envs', 'conda-foo', 'bin', 'python'),
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Conda,
                nativeEnvKind: NativePythonEnvironmentKind.Conda,
                envName: 'conda-bar',
                path: path.join('home', 'user', 'miniconda3', 'envs', 'conda-bar', 'bin', 'python'),
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'Within the same category, version, and name, environments are sorted by architecture',
            envA: {
                envType: EnvironmentType.Global,
                path: path.join('opt', 'python-x86', 'bin', 'python3'),
                architecture: Architecture.x86,
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Global,
                path: path.join('opt', 'python-x64', 'bin', 'python3'),
                architecture: Architecture.x64,
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'The preferred pyenv interpreter should come before another pyenv interpreter in the same category',
            envA: {
                envType: EnvironmentType.Pyenv,
                nativeEnvKind: NativePythonEnvironmentKind.Pyenv,
                version: { major: 3, minor: 12, patch: 2 },
                path: preferredPyenv,
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Pyenv,
                nativeEnvKind: NativePythonEnvironmentKind.Pyenv,
                version: { major: 3, minor: 10, patch: 2 },
                path: path.join('path', 'to', 'normal', 'pyenv'),
            } as PythonEnvironment,
            expected: -1,
        },
    ];

    testcases.forEach(({ title, envA, envB, expected }) => {
        test(title, async () => {
            const envTypeComparer = new EnvironmentTypeComparer(interpreterHelper);
            await envTypeComparer.initialize(undefined);
            const result = envTypeComparer.getComparator(undefined)(envA, envB);

            assert.strictEqual(result, expected);
        });
    });
});

// --- Start Positron ---
suite('Environment sorting context', () => {
    const workspaceA = path.join('path', 'to', 'workspace-a');
    const workspaceB = path.join('path', 'to', 'workspace-b');
    const customDir = path.join('opt', 'shared');
    let interpreterHelper: IInterpreterHelper;
    let getWorkspaceFolderPathsStub: sinon.SinonStub;
    let getCustomEnvDirsStub: sinon.SinonStub;

    setup(() => {
        interpreterHelper = {
            // In a multi-root workspace this returns nothing unless a resource resolves to a
            // folder, which is why the sorting context can't be derived from it.
            getActiveWorkspaceUri: sinon.stub().returns(undefined),
            getInterpreterTypeDisplayName: sinon.stub(),
        } as unknown as IInterpreterHelper;
        sinon.stub(externalDependencies, 'pathExistsSync').returns(true);
        getWorkspaceFolderPathsStub = sinon.stub(workspaceApis, 'getWorkspaceFolderPaths').returns([]);
        getCustomEnvDirsStub = sinon.stub(interpreterSettings, 'getCustomEnvDirs').returns([]);
    });

    teardown(() => {
        sinon.restore();
    });

    // An env in the second folder of a multi-root workspace, and a newer global venv that would
    // win if the project env were miscategorized as global.
    const projectEnv = {
        envType: EnvironmentType.Venv,
        nativeEnvKind: NativePythonEnvironmentKind.Venv,
        envPath: path.join(workspaceB, '.venv'),
        path: path.join(workspaceB, '.venv', 'bin', 'python'),
        version: { major: 3, minor: 10, patch: 2, raw: '3.10.2' },
    } as PythonEnvironment;
    const newerGlobalEnv = {
        envType: EnvironmentType.Venv,
        nativeEnvKind: NativePythonEnvironmentKind.Venv,
        envPath: path.join('path', 'to', 'elsewhere', 'venv'),
        path: path.join('path', 'to', 'elsewhere', 'venv', 'bin', 'python'),
        version: { major: 3, minor: 13, patch: 1, raw: '3.13.1' },
    } as PythonEnvironment;

    test('An environment in any open folder is a project environment, not just the active one', () => {
        getWorkspaceFolderPathsStub.returns([workspaceA, workspaceB]);
        const envTypeComparer = new EnvironmentTypeComparer(interpreterHelper);

        const result = envTypeComparer.getComparator(undefined)(projectEnv, newerGlobalEnv);

        assert.strictEqual(result, -1);
    });

    test('getRecommended prefers a project environment in a multi-root workspace', () => {
        getWorkspaceFolderPathsStub.returns([workspaceA, workspaceB]);
        const envTypeComparer = new EnvironmentTypeComparer(interpreterHelper);

        const result = envTypeComparer.getRecommended([newerGlobalEnv, projectEnv], undefined);

        assert.strictEqual(result, projectEnv);
    });

    test('An interpreter in a custom interpreter dir outranks other global environments', () => {
        getCustomEnvDirsStub.returns([customDir]);
        const customEnv = {
            envType: EnvironmentType.Custom,
            nativeEnvKind: NativePythonEnvironmentKind.Custom,
            path: path.join(customDir, '3.10.2', 'bin', 'python'),
            version: { major: 3, minor: 10, patch: 2, raw: '3.10.2' },
        } as PythonEnvironment;
        const envTypeComparer = new EnvironmentTypeComparer(interpreterHelper);

        const result = envTypeComparer.getComparator(undefined)(customEnv, newerGlobalEnv);

        assert.strictEqual(result, -1);
    });
});

suite('getPyenvVersion tests', () => {
    let pathExistsSyncStub: sinon.SinonStub;
    let readFileSyncStub: sinon.SinonStub;
    let checkParentDirsStub: sinon.SinonStub;
    let getPyenvDirStub: sinon.SinonStub;
    let interpreterHelper: IInterpreterHelper;
    let interpreterHelperNoWorkspace: IInterpreterHelper;
    let getActiveWorkspaceUriStub: sinon.SinonStub;
    let getActiveWorkspaceNoWorkspaceUriStub: sinon.SinonStub;
    let getInterpreterTypeDisplayNameStub: sinon.SinonStub;

    setup(() => {
        const workspacePath = path.join('path', 'to', 'workspace');
        const globalPyenvDir = path.join('home', 'user', '.pyenv');
        getActiveWorkspaceUriStub = sinon.stub().returns({ folderUri: { fsPath: workspacePath } });
        getActiveWorkspaceNoWorkspaceUriStub = sinon.stub().returns(undefined);
        getInterpreterTypeDisplayNameStub = sinon.stub();

        interpreterHelper = {
            getActiveWorkspaceUri: getActiveWorkspaceUriStub,
            getInterpreterTypeDisplayName: getInterpreterTypeDisplayNameStub,
        } as unknown as IInterpreterHelper;
        interpreterHelperNoWorkspace = {
            getActiveWorkspaceUri: getActiveWorkspaceNoWorkspaceUriStub,
            getInterpreterTypeDisplayName: getInterpreterTypeDisplayNameStub,
        } as unknown as IInterpreterHelper;

        pathExistsSyncStub = sinon.stub(externalDependencies, 'pathExistsSync');
        pathExistsSyncStub.withArgs('').returns(false);
        pathExistsSyncStub.withArgs(path.join(workspacePath, '.python-version')).returns(true);
        pathExistsSyncStub.withArgs(path.join(globalPyenvDir, 'version')).returns(true);
        readFileSyncStub = sinon.stub(externalDependencies, 'readFileSync');
        readFileSyncStub.withArgs(path.join(workspacePath, '.python-version')).returns('3.10.2');
        readFileSyncStub.withArgs(path.join(globalPyenvDir, 'version')).returns('my_global_pyenv');
        checkParentDirsStub = sinon.stub(externalDependencies, 'checkParentDirs');
        getPyenvDirStub = sinon.stub(pyenvUtils, 'getPyenvDir');
        getPyenvDirStub.withArgs().returns(globalPyenvDir);
        // Categorization reads the open folders and the custom interpreter dirs from settings.
        sinon.stub(workspaceApis, 'getWorkspaceFolderPaths').returns([workspacePath]);
        sinon.stub(interpreterSettings, 'getCustomEnvDirs').returns([]);
    });

    teardown(() => {
        pathExistsSyncStub.restore();
        readFileSyncStub.restore();
        checkParentDirsStub.restore();
        getPyenvDirStub.restore();
        sinon.restore();
    });

    test('getPyenvVersion returns local if a local .python-version file exists', () => {
        const workspacePath = path.join('path', 'to', 'workspace');
        const expected = '3.10.2';
        const result = getPyenvVersion(workspacePath);
        assert.strictEqual(result, expected);
    });
    test('getPyenvVersion returns global if no local .python-version file exists', () => {
        const expected = 'my_global_pyenv';
        const result = getPyenvVersion(undefined);
        assert.strictEqual(result, expected);
    });
    test('getRecommended recommends the local pyenv version over global pythons and other pyenv versions', () => {
        const envA = {
            // global python
            path: 'path',
            envType: EnvironmentType.Global,
            version: { major: 3, minor: 12, patch: 2, raw: '3.12.2' },
        } as PythonEnvironment;
        const envB = {
            // pyenv version, does not match local .python-version or global pyenv
            path: 'path',
            envType: EnvironmentType.Pyenv,
            nativeEnvKind: NativePythonEnvironmentKind.Pyenv,
            version: { major: 3, minor: 11, patch: 2, raw: '3.11.2' },
        } as PythonEnvironment;
        const envC = {
            // local pyenv version for the workspace
            path: 'path',
            envType: EnvironmentType.Pyenv,
            nativeEnvKind: NativePythonEnvironmentKind.Pyenv,
            version: { major: 3, minor: 10, patch: 2, raw: '3.10.2' },
        } as PythonEnvironment;
        const envD = {
            // global pyenv version
            path: 'path',
            envType: EnvironmentType.Pyenv,
            nativeEnvKind: NativePythonEnvironmentKind.Pyenv,
            version: { major: 3, minor: 11, patch: 3, raw: '3.11.3' },
            envName: 'my_global_pyenv',
        } as PythonEnvironment;

        const pythonEnvironments = [envA, envB, envC, envD];

        const workspacePath = path.join('path', 'to', 'workspace');
        const workspace = Uri.file(workspacePath);
        const expected = envC;
        const envTypeComparer = new EnvironmentTypeComparer(interpreterHelper);
        const result = envTypeComparer.getRecommended(pythonEnvironments, workspace);
        assert.strictEqual(result, expected);
    });
    test('getRecommended recommends the global pyenv version over global pythons and other pyenv versions', () => {
        const envA = {
            // global python
            path: 'path',
            envType: EnvironmentType.Global,
            version: { major: 3, minor: 12, patch: 2, raw: '3.12.2' },
        } as PythonEnvironment;
        const envB = {
            // pyenv version, does not match local .python-version or global pyenv
            path: 'path',
            envType: EnvironmentType.Pyenv,
            nativeEnvKind: NativePythonEnvironmentKind.Pyenv,
            version: { major: 3, minor: 11, patch: 2, raw: '3.11.2' },
        } as PythonEnvironment;
        const envC = {
            // local pyenv version for the workspace
            path: 'path',
            envType: EnvironmentType.Pyenv,
            nativeEnvKind: NativePythonEnvironmentKind.Pyenv,
            version: { major: 3, minor: 10, patch: 2, raw: '3.10.2' },
        } as PythonEnvironment;
        const envD = {
            // global pyenv version
            path: 'path',
            envType: EnvironmentType.Pyenv,
            nativeEnvKind: NativePythonEnvironmentKind.Pyenv,
            version: { major: 3, minor: 11, patch: 3, raw: '3.11.3' },
            envName: 'my_global_pyenv',
        } as PythonEnvironment;

        const pythonEnvironments = [envA, envB, envC, envD];

        const workspace = undefined;
        const expected = envD;
        const envTypeComparer = new EnvironmentTypeComparer(interpreterHelperNoWorkspace);
        const result = envTypeComparer.getRecommended(pythonEnvironments, workspace);
        assert.strictEqual(result, expected);
    });
});

// --- End Positron ---

suite('getEnvTypeHeuristic tests', () => {
    const workspacePath = path.join('path', 'to', 'workspace');

    const localGlobalEnvTypes = [
        EnvironmentType.Venv,
        EnvironmentType.Conda,
        EnvironmentType.VirtualEnv,
        EnvironmentType.VirtualEnvWrapper,
        EnvironmentType.Pipenv,
        EnvironmentType.Poetry,
    ];

    localGlobalEnvTypes.forEach((envType) => {
        test('If the path to an environment starts with the workspace path it should be marked as local', () => {
            const environment = {
                envType,
                envPath: path.join(workspacePath, 'my-environment'),
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment;

            const envTypeHeuristic = getEnvLocationHeuristic(environment, workspacePath);

            assert.strictEqual(envTypeHeuristic, EnvLocationHeuristic.Local);
        });

        test('If the path to an environment does not start with the workspace path it should be marked as global', () => {
            const environment = {
                envType,
                envPath: path.join('path', 'to', 'my-environment'),
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment;

            const envTypeHeuristic = getEnvLocationHeuristic(environment, workspacePath);

            assert.strictEqual(envTypeHeuristic, EnvLocationHeuristic.Global);
        });

        test('If envPath is not set, fallback to path', () => {
            const environment = {
                envType,
                path: path.join(workspacePath, 'my-environment'),
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment;

            const envTypeHeuristic = getEnvLocationHeuristic(environment, workspacePath);

            assert.strictEqual(envTypeHeuristic, EnvLocationHeuristic.Local);
        });
    });

    const globalInterpretersEnvTypes = [
        EnvironmentType.System,
        EnvironmentType.MicrosoftStore,
        EnvironmentType.Global,
        EnvironmentType.Unknown,
        EnvironmentType.Pyenv,
    ];

    globalInterpretersEnvTypes.forEach((envType) => {
        test(`If the environment type is ${envType} and the environment path does not start with the workspace path it should be marked as a global interpreter`, () => {
            const environment = {
                envType,
                envPath: path.join('path', 'to', 'a', 'global', 'interpreter'),
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment;

            const envTypeHeuristic = getEnvLocationHeuristic(environment, workspacePath);

            assert.strictEqual(envTypeHeuristic, EnvLocationHeuristic.Global);
        });
    });
});

suite('isProblematicCondaEnvironment tests', () => {
    let pathExistsSyncStub: sinon.SinonStub;

    setup(() => {
        pathExistsSyncStub = sinon.stub(externalDependencies, 'pathExistsSync');
        // By default, return false for any path not explicitly configured
        pathExistsSyncStub.returns(false);
    });

    teardown(() => {
        pathExistsSyncStub.restore();
    });

    test('Non-conda environment should not be problematic', () => {
        const environment = {
            envType: EnvironmentType.Venv,
            path: '/path/to/venv/bin/python',
            version: { major: 3, minor: 10, patch: 2 },
        } as PythonEnvironment;

        const result = isProblematicCondaEnvironment(environment);
        assert.strictEqual(result, false);
    });

    test('Conda environment with path "python" should be problematic', () => {
        const environment = {
            envType: EnvironmentType.Conda,
            path: 'python',
            version: { major: 3, minor: 10, patch: 2 },
        } as PythonEnvironment;

        const result = isProblematicCondaEnvironment(environment);
        assert.strictEqual(result, true);
    });

    test('Conda environment with existing predicted path should not be problematic', () => {
        const predictedPath = '/path/to/miniforge3/envs/testenvtestenv1234/python';
        pathExistsSyncStub.withArgs(predictedPath).returns(true);

        const environment = {
            envType: EnvironmentType.Conda,
            path: predictedPath,
            envPath: '/path/to/miniforge3/envs/testenvtestenv1234',
            version: { major: 3, minor: 10, patch: 2 },
        } as PythonEnvironment;

        const result = isProblematicCondaEnvironment(environment);
        assert.strictEqual(result, false);
    });

    test('Conda environment with non-existent predicted path but existing Unix python should not be problematic', () => {
        const predictedPath = '/path/to/miniforge3/envs/testenvtestenv1234/python';
        const envPath = 'test/miniforge3/envs/testenv1234';
        const unixPath = path.join(envPath, 'bin', 'python');
        const windowsPath = path.join(envPath, 'Scripts', 'python.exe');

        pathExistsSyncStub.withArgs(predictedPath).returns(false);
        pathExistsSyncStub.withArgs(unixPath).returns(true);
        pathExistsSyncStub.withArgs(windowsPath).returns(false);

        const environment = {
            envType: EnvironmentType.Conda,
            path: predictedPath,
            envPath: envPath,
            version: { major: 3, minor: 10, patch: 2 },
        } as PythonEnvironment;

        const result = isProblematicCondaEnvironment(environment);
        assert.strictEqual(result, false);
    });

    test('Conda environment with non-existent predicted path but existing Windows python should not be problematic', () => {
        const predictedPath = 'C:\\Users\\test\\miniforge3\\envs\\testenv1234\\python.exe';
        const envPath = 'C:\\Users\\test\\miniforge3\\envs\\testenv1234';
        // The actual paths that path.join() will generate (mixed separators due to running on Unix)
        const unixPath = path.join(envPath, 'bin', 'python');
        const windowsPath = path.join(envPath, 'Scripts', 'python.exe');

        pathExistsSyncStub.withArgs(predictedPath).returns(false);
        pathExistsSyncStub.withArgs(unixPath).returns(false);
        pathExistsSyncStub.withArgs(windowsPath).returns(true);

        const environment = {
            envType: EnvironmentType.Conda,
            path: predictedPath,
            envPath: envPath,
            version: { major: 3, minor: 10, patch: 2 },
        } as PythonEnvironment;

        const result = isProblematicCondaEnvironment(environment);
        assert.strictEqual(result, false);
    });

    test('Conda environment with non-existent predicted path and no python anywhere should be problematic', () => {
        const predictedPath = '/path/to/miniforge3/envs/testenvtestenv1234/python';
        const envPath = '/path/to/miniforge3/envs/testenvtestenv1234';
        const unixPath = path.join(envPath, 'bin', 'python');
        const windowsPath = path.join(envPath, 'Scripts', 'python.exe');

        pathExistsSyncStub.withArgs(predictedPath).returns(false);
        pathExistsSyncStub.withArgs(unixPath).returns(false);
        pathExistsSyncStub.withArgs(windowsPath).returns(false);

        const environment = {
            envType: EnvironmentType.Conda,
            path: predictedPath,
            envPath: envPath,
            version: { major: 3, minor: 10, patch: 2 },
        } as PythonEnvironment;

        const result = isProblematicCondaEnvironment(environment);
        assert.strictEqual(result, true);
    });

    test('Conda environment without envPath should be problematic if predicted path does not exist', () => {
        const predictedPath = '/path/to/miniforge3/envs/testenvtestenv1234/python';
        pathExistsSyncStub.withArgs(predictedPath).returns(false);

        const environment = {
            envType: EnvironmentType.Conda,
            path: predictedPath,
            // No envPath provided
            version: { major: 3, minor: 10, patch: 2 },
        } as PythonEnvironment;

        const result = isProblematicCondaEnvironment(environment);
        assert.strictEqual(result, true);
    });

    test('Conda environment with actual bin/python path should not be problematic', () => {
        const actualPath = '/path/to/miniforge3/envs/testenvtestenv1234/bin/python';
        pathExistsSyncStub.withArgs(actualPath).returns(true);

        const environment = {
            envType: EnvironmentType.Conda,
            path: actualPath,
            envPath: '/path/to/miniforge3/envs/testenvtestenv1234',
            version: { major: 3, minor: 10, patch: 2 },
        } as PythonEnvironment;

        const result = isProblematicCondaEnvironment(environment);
        assert.strictEqual(result, false);
    });
});
