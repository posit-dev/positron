/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { interfaces } from 'inversify';
import { EXTENSION_ROOT_DIR } from '../../client/constants';
import * as fs from '../../client/common/platform/fs-paths';
import { getIpykernelBundle } from '../../client/positron/ipykernel';
import { IPythonExecutionFactory, IPythonExecutionService } from '../../client/common/process/types';
import { InterpreterInformation, PythonEnvironment } from '../../client/pythonEnvironments/info';
import { IServiceContainer } from '../../client/ioc/types';
import { IWorkspaceService } from '../../client/common/application/types';
import { PythonVersion } from '../../client/pythonEnvironments/info/pythonVersion';
import { Architecture } from '../../client/common/utils/platform';
import { mock } from './utils';

suite('Ipykernel', () => {
    let interpreter: PythonEnvironment;
    let pythonExecutionService: IPythonExecutionService;
    let workspaceConfiguration: vscode.WorkspaceConfiguration;
    let serviceContainer: IServiceContainer;

    setup(() => {
        // Default to x64 architecture for tests
        interpreter = mock<PythonEnvironment>({
            id: 'pythonEnvironmentId',
            path: '/path/to/python',
            version: mock<PythonVersion>({ major: 3, minor: 9 }),
            architecture: Architecture.x64,
        });

        pythonExecutionService = mock<IPythonExecutionService>({
            getInterpreterInformation: () =>
                Promise.resolve(
                    mock<InterpreterInformation>({ implementation: 'cpython', version: interpreter.version }),
                ),
        });

        const pythonExecutionFactory = mock<IPythonExecutionFactory>({
            create: () => Promise.resolve(pythonExecutionService),
        });

        workspaceConfiguration = mock<vscode.WorkspaceConfiguration>({
            get: (section: string) => (section === 'useBundledIpykernel' ? true : undefined),
        });
        const workspaceService = mock<IWorkspaceService>({
            workspaceFolders: undefined,
            getWorkspaceFolder: () => undefined,
            getConfiguration: () => workspaceConfiguration,
        });

        serviceContainer = mock<IServiceContainer>({
            get: <T>(serviceIdentifier: interfaces.ServiceIdentifier<T>) => {
                switch (serviceIdentifier) {
                    case IPythonExecutionFactory:
                        return pythonExecutionFactory as T;
                    case IWorkspaceService:
                        return workspaceService as T;
                    default:
                        return undefined as T;
                }
            },
        });
    });

    test('should bundle ipykernel for supported implementation and version (x64)', async () => {
        // Start a console session with ipykernel bundle paths.
        const ipykernelBundle = await getIpykernelBundle(interpreter, serviceContainer);

        // Ipykernel bundles should be added to the PYTHONPATH using the interpreter's architecture.
        assert.deepStrictEqual(ipykernelBundle.paths, [
            path.join(EXTENSION_ROOT_DIR, 'python_files', 'lib', 'ipykernel', 'x64', 'cp39'),
            path.join(EXTENSION_ROOT_DIR, 'python_files', 'lib', 'ipykernel', 'x64', 'cp3'),
            path.join(EXTENSION_ROOT_DIR, 'python_files', 'lib', 'ipykernel', 'py3'),
        ]);
    });

    test('should bundle ipykernel for arm64 interpreter architecture', async () => {
        // Set interpreter to arm64 architecture
        sinon.stub(interpreter, 'architecture').get(() => Architecture.arm64);

        const ipykernelBundle = await getIpykernelBundle(interpreter, serviceContainer);

        // Ipykernel bundles should use arm64 path
        assert.deepStrictEqual(ipykernelBundle.paths, [
            path.join(EXTENSION_ROOT_DIR, 'python_files', 'lib', 'ipykernel', 'arm64', 'cp39'),
            path.join(EXTENSION_ROOT_DIR, 'python_files', 'lib', 'ipykernel', 'arm64', 'cp3'),
            path.join(EXTENSION_ROOT_DIR, 'python_files', 'lib', 'ipykernel', 'py3'),
        ]);
    });

    test('should fall back to system architecture when interpreter architecture is unknown', async () => {
        // Set interpreter architecture to unknown
        sinon.stub(interpreter, 'architecture').get(() => Architecture.Unknown);

        const ipykernelBundle = await getIpykernelBundle(interpreter, serviceContainer);

        // Should fall back to system architecture
        const systemArch = os.arch();
        assert.deepStrictEqual(ipykernelBundle.paths, [
            path.join(EXTENSION_ROOT_DIR, 'python_files', 'lib', 'ipykernel', systemArch, 'cp39'),
            path.join(EXTENSION_ROOT_DIR, 'python_files', 'lib', 'ipykernel', systemArch, 'cp3'),
            path.join(EXTENSION_ROOT_DIR, 'python_files', 'lib', 'ipykernel', 'py3'),
        ]);
    });

    test('should not bundle ipykernel if setting is disabled', async () => {
        // Disable ipykernel bundling.
        sinon.stub(workspaceConfiguration, 'get').withArgs('useBundledIpykernel').returns(false);

        const ipykernelBundle = await getIpykernelBundle(interpreter, serviceContainer);

        assert.strictEqual(ipykernelBundle.paths, undefined);
        assert.ok(ipykernelBundle.disabledReason);
    });

    test('should not bundle ipykernel if version is incompatible', async () => {
        // Stub the interpreter version to be incompatible.
        sinon.stub(interpreter, 'version').get(() => mock<PythonVersion>({ major: 2, minor: 7 }));

        const ipykernelBundle = await getIpykernelBundle(interpreter, serviceContainer);

        assert.strictEqual(ipykernelBundle.paths, undefined);
        assert.ok(ipykernelBundle.disabledReason);
    });

    test('should not bundle ipykernel if implementation is incompatible', async () => {
        // Stub the interpreter implementation to be incompatible.
        sinon.stub(pythonExecutionService, 'getInterpreterInformation').resolves(
            mock<InterpreterInformation>({ implementation: 'not_cpython', version: interpreter.version }),
        );

        const ipykernelBundle = await getIpykernelBundle(interpreter, serviceContainer);

        assert.strictEqual(ipykernelBundle.paths, undefined);
        assert.ok(ipykernelBundle.disabledReason);
    });

    test('should not bundle ipykernel if bundle path does not exist', async () => {
        // Simulate the bundle paths not existing.
        sinon.stub(fs, 'pathExists').resolves(false);

        const ipykernelBundle = await getIpykernelBundle(interpreter, serviceContainer);

        assert.strictEqual(ipykernelBundle.paths, undefined);
        assert.ok(ipykernelBundle.disabledReason);
    });
});
