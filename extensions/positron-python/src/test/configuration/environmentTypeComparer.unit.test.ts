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
} from '../../client/interpreter/configuration/environmentTypeComparer';
import { IInterpreterHelper } from '../../client/interpreter/contracts';
import { PythonEnvType } from '../../client/pythonEnvironments/base/info';
import * as pyenv from '../../client/pythonEnvironments/common/environmentManagers/pyenv';
import { EnvironmentType, PythonEnvironment } from '../../client/pythonEnvironments/info';
// --- Start Positron ---
import * as externalDependencies from '../../client/pythonEnvironments/common/externalDependencies';
import { getPyenvVersion } from '../../client/interpreter/configuration/environmentTypeComparer';
import * as pyenvUtils from '../../client/pythonEnvironments/common/environmentManagers/pyenv';
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
            title: 'Local virtual environment should come first',
            envA: {
                envType: EnvironmentType.Venv,
                type: PythonEnvType.Virtual,
                envPath: path.join(workspacePath, '.venv'),
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.System,
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: -1,
        },
        {
            title: "Non-local virtual environment should not come first when there's a local env",
            envA: {
                envType: EnvironmentType.Venv,
                type: PythonEnvType.Virtual,
                envPath: path.join('path', 'to', 'other', 'workspace', '.venv'),
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Venv,
                type: PythonEnvType.Virtual,
                envPath: path.join(workspacePath, '.venv'),
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: "Conda environment should not come first when there's a local env",
            envA: {
                envType: EnvironmentType.Conda,
                type: PythonEnvType.Conda,
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Venv,
                type: PythonEnvType.Virtual,
                envPath: path.join(workspacePath, '.venv'),
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'Conda base environment should come after any other conda env',
            envA: {
                envType: EnvironmentType.Conda,
                type: PythonEnvType.Conda,
                envName: 'base',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Conda,
                type: PythonEnvType.Conda,
                envName: 'random-name',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'Pipenv environment should come before any other conda env',
            envA: {
                envType: EnvironmentType.Conda,
                type: PythonEnvType.Conda,
                envName: 'conda-env',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Pipenv,
                envName: 'pipenv-env',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,

            expected: 1,
        },
        {
            title: 'System environment should not come first when there are global envs',
            envA: {
                envType: EnvironmentType.System,
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Poetry,
                type: PythonEnvType.Virtual,
                envName: 'poetry-env',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'Pyenv interpreter should not come first when there are global envs',
            envA: {
                envType: EnvironmentType.Pyenv,
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Pipenv,
                type: PythonEnvType.Virtual,
                envName: 'pipenv-env',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        // --- Start Positron ---
        // We inherit the above test case from upstream but its description appears to be incorrect.
        {
            title: 'Pyenv interpreter SHOULD come before global/system envs',
            envA: {
                envType: EnvironmentType.Pyenv,
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Global,
                version: { major: 3, minor: 12, patch: 2 },
            } as PythonEnvironment,
            expected: -1,
        },
        // --- End Positron ---
        {
            title: 'Preferred Pyenv interpreter should come before any global interpreter',
            envA: {
                envType: EnvironmentType.Pyenv,
                version: { major: 3, minor: 12, patch: 2 },
                path: preferredPyenv,
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Pyenv,
                version: { major: 3, minor: 10, patch: 2 },
                path: path.join('path', 'to', 'normal', 'pyenv'),
            } as PythonEnvironment,
            expected: -1,
        },
        {
            title: 'Pyenv interpreters should come first when there are global interpreters',
            envA: {
                envType: EnvironmentType.Global,
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Pyenv,
                version: { major: 3, minor: 7, patch: 2 },
                path: path.join('path', 'to', 'normal', 'pyenv'),
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'Global environment should not come first when there are global envs',
            envA: {
                envType: EnvironmentType.Global,
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Poetry,
                type: PythonEnvType.Virtual,
                envName: 'poetry-env',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'Microsoft Store environment should not come first when there are global envs',
            envA: {
                envType: EnvironmentType.MicrosoftStore,
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.VirtualEnv,
                type: PythonEnvType.Virtual,
                envName: 'virtualenv-env',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'Microsoft Store interpreter should not come first when there are global interpreters with higher version',
            envA: {
                envType: EnvironmentType.MicrosoftStore,
                version: { major: 3, minor: 10, patch: 2, raw: '3.10.2' },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Global,
                version: { major: 3, minor: 11, patch: 2, raw: '3.11.2' },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'Unknown environment should not come first when there are global envs',
            envA: {
                envType: EnvironmentType.Unknown,
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Pipenv,
                type: PythonEnvType.Virtual,
                envName: 'pipenv-env',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'If 2 environments are of the same type, the most recent Python version comes first',
            envA: {
                envType: EnvironmentType.Venv,
                type: PythonEnvType.Virtual,
                envPath: path.join(workspacePath, '.old-venv'),
                version: { major: 3, minor: 7, patch: 5, raw: '3.7.5' },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Venv,
                type: PythonEnvType.Virtual,
                envPath: path.join(workspacePath, '.venv'),
                version: { major: 3, minor: 10, patch: 2, raw: '3.10.2' },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: "If 2 global environments have the same Python version and there's a Conda one, the Conda env should not come first",
            envA: {
                envType: EnvironmentType.Conda,
                type: PythonEnvType.Conda,
                envName: 'conda-env',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Pipenv,
                type: PythonEnvType.Virtual,
                envName: 'pipenv-env',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'If 2 global environments are of the same type and have the same Python version, they should be sorted by name',
            envA: {
                envType: EnvironmentType.Conda,
                type: PythonEnvType.Conda,
                envName: 'conda-foo',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Conda,
                type: PythonEnvType.Conda,
                envName: 'conda-bar',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'If 2 global interpreters have the same Python version, they should be sorted by architecture',
            envA: {
                envType: EnvironmentType.Global,
                architecture: Architecture.x86,
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Global,
                architecture: Architecture.x64,
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'Problematic environments should come last',
            envA: {
                envType: EnvironmentType.Conda,
                type: PythonEnvType.Conda,
                envPath: path.join(workspacePath, '.venv'),
                path: 'python',
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.System,
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
    ];

    testcases.forEach(({ title, envA, envB, expected }) => {
        test(title, async () => {
            const envTypeComparer = new EnvironmentTypeComparer(interpreterHelper);
            await envTypeComparer.initialize(undefined);
            const result = envTypeComparer.compare(envA, envB);

            assert.strictEqual(result, expected);
        });
    });
});

// --- Start Positron ---
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
            version: { major: 3, minor: 11, patch: 2, raw: '3.11.2' },
        } as PythonEnvironment;
        const envC = {
            // local pyenv version for the workspace
            path: 'path',
            envType: EnvironmentType.Pyenv,
            version: { major: 3, minor: 10, patch: 2, raw: '3.10.2' },
        } as PythonEnvironment;
        const envD = {
            // global pyenv version
            path: 'path',
            envType: EnvironmentType.Pyenv,
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
            version: { major: 3, minor: 11, patch: 2, raw: '3.11.2' },
        } as PythonEnvironment;
        const envC = {
            // local pyenv version for the workspace
            path: 'path',
            envType: EnvironmentType.Pyenv,
            version: { major: 3, minor: 10, patch: 2, raw: '3.10.2' },
        } as PythonEnvironment;
        const envD = {
            // global pyenv version
            path: 'path',
            envType: EnvironmentType.Pyenv,
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
