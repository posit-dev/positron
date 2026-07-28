/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { assert } from 'chai';
import { interfaces } from 'inversify';
import { anything, instance, mock as tsMock, reset, when } from 'ts-mockito';
import {
    createPythonRuntimeMetadata,
    getRuntimeSourceAndShortName,
    PythonRuntimeExtraData,
} from '../../client/positron/runtime';
import { EnvironmentType, PythonEnvironment } from '../../client/pythonEnvironments/info';
import { NativePythonEnvironmentKind } from '../../client/pythonEnvironments/base/locators/common/nativePythonUtils';
import {
    ModuleMetadata,
    moduleMetadataMap,
} from '../../client/pythonEnvironments/base/locators/lowLevel/moduleEnvironmentLocator';
import { PythonEnvironmentCategory } from '../../client/positron/interpreterCategorization';
import { IInstaller, ProductInstallStatus } from '../../client/common/types';
import { IApplicationEnvironment, IWorkspaceService } from '../../client/common/application/types';
import { IServiceContainer } from '../../client/ioc/types';
import { mockedVSCodeNamespaces } from '../vscode-mock';
import { mock } from './utils';

function version(raw: string): PythonEnvironment['version'] {
    const [major, minor, patch] = raw.split('.').map(Number);
    return { major, minor, patch, raw, build: [], prerelease: [] };
}

function pyEnv(overrides: Partial<PythonEnvironment>): PythonEnvironment {
    return mock<PythonEnvironment>({
        path: '/usr/bin/python3',
        envType: EnvironmentType.Unknown,
        version: version('3.13.2'),
        ...overrides,
    });
}

suite('getRuntimeSourceAndShortName', () => {
    const MODULE_METADATA: ModuleMetadata = {
        type: 'module',
        environmentName: 'Python-Leaves',
        modules: ['python/3.12.8', 'answers/everything'],
        startupCommand: 'module load python/3.12.8 && module load answers/everything',
        version: '3.12.8',
    };

    test('labels a module interpreter with the module manager token and its configured env name', () => {
        // Regression: module interpreters are categorized as Base (no named env), but the
        // module's own environment name is still the most useful thing to show the user, so
        // it must survive rather than being dropped in favor of the generic "module" token.
        const interp = pyEnv({ path: '/opt/software/python/3.12.8/bin/python3', version: version('3.12.8') });
        const result = getRuntimeSourceAndShortName(interp, '3.12.8', MODULE_METADATA, {
            workspaceFolders: [],
            customInterpreterDirs: [],
        });

        assert.strictEqual(result.runtimeShortName, '3.12.8 (module: Python-Leaves)');
        assert.strictEqual(result.runtimeSource, 'Base Interpreters');
        assert.strictEqual(result.category, PythonEnvironmentCategory.BaseInterpreter);
        // Base category, but module Pythons must launch with their module loaded, so they
        // are never venv seeds.
        assert.isFalse(result.validVenvSeed);
    });

    test('uses the parent project name for a .venv environment', () => {
        const interp = pyEnv({
            path: '/home/user/my-python-project/.venv/bin/python',
            envType: EnvironmentType.Venv,
            envName: '.venv',
            nativeEnvKind: NativePythonEnvironmentKind.Venv,
            version: version('3.10.17'),
        });
        const result = getRuntimeSourceAndShortName(interp, '3.10.17', undefined, {
            workspaceFolders: ['/home/user/my-python-project'],
            customInterpreterDirs: [],
        });

        assert.strictEqual(result.runtimeShortName, '3.10.17 (venv: my-python-project)');
        assert.strictEqual(result.runtimeSource, 'Project Environments');
        assert.strictEqual(result.category, PythonEnvironmentCategory.ProjectEnvironment);
    });

    test('omits the environment name when it matches the Python version', () => {
        const interp = pyEnv({
            path: '/usr/bin/python3',
            envType: EnvironmentType.System,
            envName: '3.12.3',
            version: version('3.12.3'),
        });
        const result = getRuntimeSourceAndShortName(interp, '3.12.3', undefined, {
            workspaceFolders: [],
            customInterpreterDirs: [],
        });

        assert.strictEqual(result.runtimeShortName, '3.12.3 (system)');
    });
});

suite('createPythonRuntimeMetadata', () => {
    function buildContainer(workspaceFolderPaths: string[] = []): IServiceContainer {
        const installer = mock<IInstaller>({
            isProductVersionCompatible: () => Promise.resolve(ProductInstallStatus.Installed),
        });
        // Force ipykernel bundling off so getIpykernelBundle short-circuits deterministically
        // (independent of whether the real bundle files exist on disk in the test env), and
        // installer.isProductVersionCompatible above stands in as "compatible" either way.
        const pythonConfig = mock<vscode.WorkspaceConfiguration>({
            get: (section: string) => (section === 'useBundledIpykernel' ? false : undefined),
        });
        const workspaceFolders = workspaceFolderPaths.map((fsPath) =>
            mock<vscode.WorkspaceFolder>({ uri: mock<vscode.Uri>({ fsPath }) }),
        );
        const workspaceService = mock<IWorkspaceService>({
            workspaceFolders,
            getConfiguration: () => pythonConfig,
        });
        const applicationEnv = mock<IApplicationEnvironment>({ packageJson: { version: '2026.1.0' } });

        return mock<IServiceContainer>({
            get: <T>(serviceIdentifier: interfaces.ServiceIdentifier<T>) => {
                switch (serviceIdentifier) {
                    case IInstaller:
                        return installer as T;
                    case IWorkspaceService:
                        return workspaceService as T;
                    case IApplicationEnvironment:
                        return applicationEnv as T;
                    default:
                        return undefined as T;
                }
            },
        });
    }

    setup(() => {
        // vscode.workspace.getConfiguration is called directly (not via IWorkspaceService) for
        // 'kernelSupervisor' (session location, 1-arg call) and, transitively via
        // getCustomEnvDirs() -> workspaceApis.getConfiguration, for 'python'
        // (interpreters.include/.exclude/.override, called with an explicit undefined scope, so
        // 2 args). One key-driven fake config, keyed off the setting name rather than the
        // section, covers both call shapes.
        const workspaceConfig = tsMock<vscode.WorkspaceConfiguration>();
        when(workspaceConfig.get(anything(), anything())).thenCall((key: string, defaultValue: unknown) =>
            key === 'shutdownTimeout' ? 'immediately' : defaultValue ?? [],
        );
        when(workspaceConfig.get(anything())).thenCall((key: string) =>
            key === 'shutdownTimeout' ? 'immediately' : [],
        );
        when(mockedVSCodeNamespaces.workspace!.getConfiguration(anything())).thenReturn(instance(workspaceConfig));
        when(mockedVSCodeNamespaces.workspace!.getConfiguration(anything(), anything())).thenReturn(
            instance(workspaceConfig),
        );
    });

    teardown(() => reset(mockedVSCodeNamespaces.workspace));

    test('runtimeId is unchanged when runtimeSource/runtimeName change', async () => {
        // Build one interpreter, compute metadata, capture runtimeId. It must equal
        // sha256(path + pythonVersion).slice(0,32) regardless of category labeling.
        const interp = pyEnv({ path: '/home/user/some-tool/python', version: version('3.13.2') });
        const meta = await createPythonRuntimeMetadata(interp, buildContainer(), false);
        const expected = crypto
            .createHash('sha256')
            .update(interp.path)
            .update('3.13.2')
            .digest('hex')
            .substring(0, 32);
        assert.strictEqual(meta.runtimeId, expected);
    });

    test('project venv gets Project Environments source, uv manager token, category 1', async () => {
        const projectDir = '/repos/my-project';
        const projectUvVenv = pyEnv({
            path: `${projectDir}/.venv/bin/python`,
            envType: EnvironmentType.Uv,
            envName: '.venv',
            envPath: `${projectDir}/.venv`,
            nativeEnvKind: NativePythonEnvironmentKind.UvWorkspace,
            version: version('3.13.2'),
        });
        const meta = await createPythonRuntimeMetadata(projectUvVenv, buildContainer([projectDir]), false);

        assert.strictEqual(meta.runtimeSource, 'Project Environments');
        assert.match(meta.runtimeName, /^Python 3\.13\.2 \(uv: my-project\)$/);
        assert.strictEqual(
            (meta.extraRuntimeData as PythonRuntimeExtraData).environmentCategory,
            PythonEnvironmentCategory.ProjectEnvironment,
        );
        // runtimeSource is now a display label, so the machine-readable manager token
        // (consumed by PackageManagerFactory) must be carried separately in extra data.
        assert.strictEqual((meta.extraRuntimeData as PythonRuntimeExtraData).managerToken, 'uv');
        assert.strictEqual(typeof meta.runtimeSortKey, 'number');
        // Dedicated environments are never venv seeds.
        assert.isFalse((meta.extraRuntimeData as PythonRuntimeExtraData).isValidVenvSeed);
    });

    test('stamps isValidVenvSeed: true for a base interpreter, false for a module-managed one', async () => {
        const baseInterp = pyEnv({ path: '/opt/python/3.13/bin/python', version: version('3.13.2') });
        const baseMeta = await createPythonRuntimeMetadata(baseInterp, buildContainer(), false);
        assert.isTrue((baseMeta.extraRuntimeData as PythonRuntimeExtraData).isValidVenvSeed);

        // Same interpreter shape, but keyed in the module metadata map (as after module
        // discovery or reconciliation onto a native path): not a venv seed.
        const moduleInterp = pyEnv({ path: '/opt/apps/python/3.13/bin/python', version: version('3.13.2') });
        moduleMetadataMap.set(moduleInterp.path, {
            type: 'module',
            environmentName: 'Python-3.13',
            modules: ['python/3.13'],
            startupCommand: 'module load python/3.13',
            version: '3.13.2',
        });
        try {
            const moduleMeta = await createPythonRuntimeMetadata(moduleInterp, buildContainer(), false);
            assert.isFalse((moduleMeta.extraRuntimeData as PythonRuntimeExtraData).isValidVenvSeed);
        } finally {
            moduleMetadataMap.delete(moduleInterp.path);
        }
    });

    test('unsupported version keeps the Unsupported: prefix', async () => {
        const oldSystemPython = pyEnv({
            path: '/usr/bin/python2.7',
            envType: EnvironmentType.System,
            version: version('2.7.18'),
        });
        const meta = await createPythonRuntimeMetadata(oldSystemPython, buildContainer(), false);

        assert.match(meta.runtimeName, /^Unsupported: Python /);
    });
});
