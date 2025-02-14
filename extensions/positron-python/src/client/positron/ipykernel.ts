/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IServiceContainer } from '../ioc/types';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { IWorkspaceService } from '../common/application/types';
import { IPythonExecutionFactory } from '../common/process/types';
import { traceVerbose } from '../logging';

/**
 * Check if an interpreter should use the bundled ipykernel.
 *
 * @param interpreter The interpreter to check.
 * @param serviceContainer The service container to use for dependency injection.
 * @param resource The resource to scope setting to.
 */
export async function shouldUseBundledIpykernel(
    interpreter: PythonEnvironment,
    serviceContainer: IServiceContainer,
    resource?: vscode.Uri,
): Promise<boolean> {
    // Get the required services.
    const workspaceService = serviceContainer.get<IWorkspaceService>(IWorkspaceService);
    const pythonExecutionFactory = serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);

    // Check if bundling ipykernel is enabled for the resource.
    const useBundledIpykernel = workspaceService
        .getConfiguration('python', resource)
        .get<boolean>('useBundledIpykernel', true);
    if (!useBundledIpykernel) {
        traceVerbose('createPythonRuntime: ipykernel bundling is disabled');
        return false;
    }
    traceVerbose('createPythonRuntime: ipykernel bundling is enabled, checking if interpreter is supported');

    // Check if ipykernel is bundled for the interpreter version.
    // (defined in scripts/pip-compile-ipykernel.py).
    if (interpreter.version?.major !== 3 || ![8, 9, 10, 11, 12, 13].includes(interpreter.version?.minor)) {
        traceVerbose(`createPythonRuntime: ipykernel not bundled for interpreter version: ${interpreter.version?.raw}`);
        return false;
    }

    // Get the interpreter implementation if it's not already available.
    let { implementation } = interpreter;
    if (implementation === undefined) {
        const pythonExecutionService = await pythonExecutionFactory.create({ pythonPath: interpreter.path });
        implementation = (await pythonExecutionService.getInterpreterInformation())?.implementation;
    }

    // Check if ipykernel is bundled for the interpreter implementation.
    // (defined in scripts/pip-compile-ipykernel.py).
    if (implementation !== 'cpython') {
        traceVerbose(
            `createPythonRuntime: ipykernel not bundled for interpreter implementation: ${interpreter.implementation}`,
        );
        return false;
    }

    traceVerbose(`createPythonRuntime: ipykernel bundling is supported by interpreter: ${interpreter.path}`);
    return true;
}
