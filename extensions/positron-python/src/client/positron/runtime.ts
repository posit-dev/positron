/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable global-require */
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

import { IServiceContainer } from '../ioc/types';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { traceInfo } from '../logging';
import { IInstaller, Product, ProductInstallStatus } from '../common/types';
import { IApplicationEnvironment, IWorkspaceService } from '../common/application/types';
import { EXTENSION_ROOT_DIR, IPYKERNEL_VERSION, PYTHON_LANGUAGE } from '../common/constants';
import { EnvLocationHeuristic, getEnvLocationHeuristic } from '../interpreter/configuration/environmentTypeComparer';

export interface PythonRuntimeExtraData {
    pythonPath: string;
    pythonEnvironmentId: string;
}

export async function createPythonRuntimeMetadata(
    interpreter: PythonEnvironment,
    serviceContainer: IServiceContainer,
    recommendedForWorkspace: boolean,
): Promise<positron.LanguageRuntimeMetadata> {
    traceInfo('createPythonRuntime: getting service instances');
    const installer = serviceContainer.get<IInstaller>(IInstaller);
    const workspaceService = serviceContainer.get<IWorkspaceService>(IWorkspaceService);
    const applicationEnv = serviceContainer.get<IApplicationEnvironment>(IApplicationEnvironment);

    // Check Python kernel debug and log level settings
    // NOTE: We may need to pass a resource to getSettings to support multi-root workspaces
    traceInfo('createPythonRuntime: getting extension runtime settings');

    // Define the startup behavior; request immediate startup if this is the
    // recommended runtime for the workspace. Do not request immediate or implicit startup
    // if ipykernel (min version 6.19.1) is not installed -- the user should start runtime explicitly.
    let startupBehavior;
    traceInfo('createPythonRuntime: checking if ipykernel is installed');
    const hasCompatibleKernel = await installer.isProductVersionCompatible(
        Product.ipykernel,
        IPYKERNEL_VERSION,
        interpreter,
    );

    if (hasCompatibleKernel === ProductInstallStatus.Installed) {
        startupBehavior = recommendedForWorkspace
            ? positron.LanguageRuntimeStartupBehavior.Immediate
            : positron.LanguageRuntimeStartupBehavior.Implicit;
    } else {
        // Check if this is a local Python interpreter for the workspace (e.g. a local venv or conda env)
        const workspacePath = workspaceService.workspaceFolders?.[0]?.uri?.fsPath;
        const isLocal =
            workspacePath && getEnvLocationHeuristic(interpreter, workspacePath) === EnvLocationHeuristic.Local;
        startupBehavior =
            isLocal && recommendedForWorkspace
                ? positron.LanguageRuntimeStartupBehavior.Immediate
                : // If ipykernel is not installed and this is not a local Python env, require explicit startup
                  positron.LanguageRuntimeStartupBehavior.Explicit;
    }
    traceInfo(`createPythonRuntime: startup behavior: ${startupBehavior}`);

    // Get the Python version from sysVersion since only that includes alpha/beta info (e.g '3.12.0b1')
    const pythonVersion = interpreter.sysVersion?.split(' ')[0] ?? '0.0.1';
    const envName = interpreter.envName ?? '';
    const runtimeSource = interpreter.envType;

    // Construct the display name for the runtime, like 'Python (Pyenv: venv-name)'.
    let runtimeShortName = pythonVersion;

    // Add the environment type (e.g. 'Pyenv', 'Global', 'Conda', etc.)
    runtimeShortName += ` (${runtimeSource}`;

    // Add the environment name if it's not the same as the Python version
    if (envName.length > 0 && envName !== pythonVersion) {
        runtimeShortName += `: ${envName}`;
    }
    runtimeShortName += ')';
    const runtimeName = `Python ${runtimeShortName}`;

    // Create a stable ID for the runtime based on the interpreter path and version.
    const digest = crypto.createHash('sha256');
    digest.update(interpreter.path);
    digest.update(pythonVersion);
    const runtimeId = digest.digest('hex').substring(0, 32);

    // Create the runtime path.
    // TODO@softwarenerd - We will need to update this for Windows.
    const homedir = os.homedir();
    const runtimePath =
        os.platform() !== 'win32' && interpreter.path.startsWith(homedir)
            ? path.join('~', interpreter.path.substring(homedir.length))
            : interpreter.path;

    // Save the ID of the Python environment for use when creating the language
    // runtime session.
    const extraRuntimeData: PythonRuntimeExtraData = {
        pythonPath: interpreter.path,
        pythonEnvironmentId: interpreter.id || '',
    };

    // Create the metadata for the language runtime
    const metadata: positron.LanguageRuntimeMetadata = {
        runtimeId,
        runtimeName,
        runtimeShortName,
        runtimePath,
        runtimeVersion: applicationEnv.packageJson.version,
        runtimeSource,
        languageId: PYTHON_LANGUAGE,
        languageName: 'Python',
        languageVersion: pythonVersion,
        base64EncodedIconSvg: fs
            .readFileSync(path.join(EXTENSION_ROOT_DIR, 'resources', 'branding', 'python-icon.svg'))
            .toString('base64'),
        startupBehavior,
        sessionLocation: positron.LanguageRuntimeSessionLocation.Workspace,
        extraRuntimeData,
    };

    return metadata;
}
