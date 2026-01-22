/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from '../common/platform/fs-paths';
import { IServiceContainer } from '../ioc/types';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { IWorkspaceService } from '../common/application/types';
import { IPythonExecutionFactory } from '../common/process/types';
import { traceWarn } from '../logging';
import { EXTENSION_ROOT_DIR } from '../constants';
import { Architecture } from '../common/utils/platform';

/**
 * Get the architecture string for bundle path selection.
 * Returns 'arm64' or 'x64' based on the interpreter's architecture.
 * Falls back to system architecture if interpreter architecture is unknown.
 */
function getInterpreterArchString(interpreter: PythonEnvironment): string {
    if (interpreter.architecture === Architecture.arm64) {
        return 'arm64';
    }
    if (interpreter.architecture === Architecture.x64) {
        return 'x64';
    }
    // Fall back to system architecture if interpreter architecture is unknown.
    // This can happen if we haven't yet queried the interpreter for its info.
    const systemArch = os.arch();
    traceWarn(
        `Unknown interpreter architecture for ${interpreter.path}, falling back to system architecture: ${systemArch}`,
    );
    return systemArch;
}

/** Ipykernel bundle information. */
export interface IpykernelBundle {
    /** If bundling is disabled, the reason for it. */
    disabledReason?: string;

    /** Paths to be appended to the PYTHONPATH environment variable in this order, if bundling is enabled. */
    paths?: string[];
}

/**
 * Get the Ipykernel bundle for a given interpreter.
 *
 * @param interpreter The interpreter to check.
 * @param serviceContainer The service container to use for dependency injection.
 * @param resource The resource to scope setting to.
 */
export async function getIpykernelBundle(
    interpreter: PythonEnvironment,
    serviceContainer: IServiceContainer,
    resource?: vscode.Uri,
): Promise<IpykernelBundle> {
    // Get the required services.
    const workspaceService = serviceContainer.get<IWorkspaceService>(IWorkspaceService);
    const pythonExecutionFactory = serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);

    // Check if bundling ipykernel is enabled for the resource.
    const useBundledIpykernel = workspaceService
        .getConfiguration('python', resource)
        .get<boolean>('useBundledIpykernel', true);
    if (!useBundledIpykernel) {
        return { disabledReason: 'useBundledIpykernel setting is disabled' };
    }

    // Check if ipykernel is bundled for the interpreter version.
    // (defined in scripts/pip-compile-ipykernel.py).
    if (interpreter.version?.major !== 3 || ![9, 10, 11, 12, 13, 14].includes(interpreter.version?.minor)) {
        return { disabledReason: `unsupported interpreter version: ${interpreter.version?.raw}` };
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
        return { disabledReason: `unsupported interpreter implementation: ${implementation}` };
    }

    // Append the bundle paths (defined in gulpfile.js) to the PYTHONPATH environment variable.
    // Use the interpreter's architecture, not the system architecture, to select the correct bundle.
    const arch = getInterpreterArchString(interpreter);
    const cpxSpecifier = `cp${interpreter.version.major}${interpreter.version.minor}`;
    const paths = [
        path.join(EXTENSION_ROOT_DIR, 'python_files', 'lib', 'ipykernel', arch, cpxSpecifier),
        path.join(EXTENSION_ROOT_DIR, 'python_files', 'lib', 'ipykernel', arch, 'cp3'),
        path.join(EXTENSION_ROOT_DIR, 'python_files', 'lib', 'ipykernel', 'py3'),
    ];

    for (const path of paths) {
        if (!(await fs.pathExists(path))) {
            // This shouldn't happen. Did something go wrong during `npm install`?
            traceWarn(`ipykernel bundle path does not exist: ${path}`);
            return { disabledReason: `bundle path does not exist: ${path}` };
        }
    }

    return { paths };
}
