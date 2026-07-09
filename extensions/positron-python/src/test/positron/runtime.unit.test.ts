/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as TypeMoq from 'typemoq';
import { assert } from 'chai';
import { anything, reset, when } from 'ts-mockito';
import * as ipykernelModule from '../../client/positron/ipykernel';
import * as moduleLocator from '../../client/pythonEnvironments/base/locators/lowLevel/moduleEnvironmentLocator';
import * as environmentTypeComparer from '../../client/interpreter/configuration/environmentTypeComparer';
import { createPythonRuntimeMetadata, getRuntimeSourceAndShortName } from '../../client/positron/runtime';
import { IApplicationEnvironment, IWorkspaceService } from '../../client/common/application/types';
import { IServiceContainer } from '../../client/ioc/types';
import { PythonEnvironment, EnvironmentType } from '../../client/pythonEnvironments/info';
import { ModuleMetadata } from '../../client/pythonEnvironments/base/locators/lowLevel/moduleEnvironmentLocator';
import { mockedVSCodeNamespaces } from '../vscode-mock';

suite('getRuntimeSourceAndShortName', () => {
    const MODULE_METADATA: ModuleMetadata = {
        type: 'module',
        environmentName: 'Python-Leaves',
        modules: ['python/3.12.8', 'answers/everything'],
        startupCommand: 'module load python/3.12.8 && module load answers/everything',
        version: '3.12.8',
    };

    test('labels a module interpreter as Module even when envType is Unknown', () => {
        // Regression: a module-managed Python that the native locator also sees as
        // a bare global has envType Unknown; the module metadata must win so it is
        // shown as "(Module: Python-Leaves)" rather than "(Unknown)".
        const result = getRuntimeSourceAndShortName(
            '/opt/software/python/3.12.8/bin/python3',
            EnvironmentType.Unknown,
            undefined,
            '3.12.8',
            MODULE_METADATA,
        );

        assert.deepEqual(result, {
            runtimeSource: EnvironmentType.Module,
            runtimeShortName: '3.12.8 (Module: Python-Leaves)',
        });
    });

    test('uses the parent project name for a .venv environment', () => {
        const result = getRuntimeSourceAndShortName(
            '/home/user/my-python-project/.venv/bin/python',
            EnvironmentType.Venv,
            '.venv',
            '3.10.17',
            undefined,
        );

        assert.deepEqual(result, {
            runtimeSource: EnvironmentType.Venv,
            runtimeShortName: '3.10.17 (Venv: my-python-project)',
        });
    });

    test('omits the environment name when it matches the Python version', () => {
        const result = getRuntimeSourceAndShortName(
            '/usr/bin/python3',
            EnvironmentType.System,
            '3.12.3',
            '3.12.3',
            undefined,
        );

        assert.deepEqual(result, {
            runtimeSource: EnvironmentType.System,
            runtimeShortName: '3.12.3 (System)',
        });
    });
});

function makeInterpreter(interpreterPath: string): PythonEnvironment {
    return {
        path: interpreterPath,
        envType: EnvironmentType.System,
        envName: undefined,
        version: { major: 3, minor: 10, patch: 0, raw: '3.10.0', release: { type: 0, version: 0 } },
        sysVersion: '3.10.0',
        envPath: undefined,
    } as unknown as PythonEnvironment;
}

suite('createPythonRuntimeMetadata path fields', () => {
    let sandbox: sinon.SinonSandbox;
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;

    setup(() => {
        sandbox = sinon.createSandbox();

        // Return "bundled, no issues" so the installer check branch is skipped.
        sandbox.stub(ipykernelModule, 'getIpykernelBundle').resolves({ disabledReason: undefined });

        // Module metadata resolves immediately with an empty map.
        sandbox.stub(moduleLocator, 'whenModuleMetadataReady').resolves();
        moduleLocator.moduleMetadataMap.clear();

        // Suppress the version-unsupported flag in the runtime name.
        sandbox.stub(environmentTypeComparer, 'isVersionSupported').returns(true);

        // Stub vscode.workspace.getConfiguration used for the kernelSupervisor config.
        when(mockedVSCodeNamespaces.workspace!).getConfiguration(anything()).thenReturn({
            get: (_key: string, def?: unknown) => def,
        } as any);

        const workspaceService = TypeMoq.Mock.ofType<IWorkspaceService>();
        workspaceService.setup((w) => w.workspaceFolders).returns(() => []);

        const appEnv = TypeMoq.Mock.ofType<IApplicationEnvironment>();
        appEnv.setup((a) => a.packageJson).returns(() => ({ version: '2025.0.0' }));

        serviceContainer = TypeMoq.Mock.ofType<IServiceContainer>();
        serviceContainer.setup((s) => s.get(IWorkspaceService)).returns(() => workspaceService.object);
        serviceContainer.setup((s) => s.get(IApplicationEnvironment)).returns(() => appEnv.object);
    });

    teardown(() => {
        sandbox.restore();
        reset(mockedVSCodeNamespaces.workspace!);
    });

    test('runtimePath is always the full absolute interpreter path', async () => {
        const interpreterPath = '/usr/bin/python3';
        const metadata = await createPythonRuntimeMetadata(makeInterpreter(interpreterPath), serviceContainer.object, false);
        assert.strictEqual(metadata.runtimePath, interpreterPath);
    });

    test('runtimeDisplayPath uses ~ shorthand for a home-dir interpreter on non-Windows', async function () {
        if (os.platform() === 'win32') {
            this.skip();
        }
        const interpreterPath = path.join(os.homedir(), '.venv', 'bin', 'python');
        const metadata = await createPythonRuntimeMetadata(makeInterpreter(interpreterPath), serviceContainer.object, false);
        assert.ok(
            metadata.runtimeDisplayPath?.startsWith('~'),
            `Expected ~ prefix, got: ${metadata.runtimeDisplayPath}`,
        );
        assert.strictEqual(metadata.runtimePath, interpreterPath, 'runtimePath must remain absolute');
    });

    test('runtimeDisplayPath is undefined for a system (non-home-dir) interpreter', async () => {
        const interpreterPath = '/usr/bin/python3';
        const metadata = await createPythonRuntimeMetadata(makeInterpreter(interpreterPath), serviceContainer.object, false);
        assert.strictEqual(metadata.runtimeDisplayPath, undefined);
    });
});
