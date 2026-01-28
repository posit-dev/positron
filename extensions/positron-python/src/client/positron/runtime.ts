/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
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
import {
    EnvLocationHeuristic,
    getEnvLocationHeuristic,
    isVersionSupported,
} from '../interpreter/configuration/environmentTypeComparer';
import { getIpykernelBundle, IpykernelBundle } from './ipykernel';
import { moduleMetadataMap } from '../pythonEnvironments/base/locators/lowLevel/moduleEnvironmentLocator';

/**
 * Module metadata for Python interpreters discovered via environment modules.
 */
export interface PythonModuleMetadata {
    type: 'module';
    environmentName: string;
    modules: string[];
    startupCommand: string;
}

export interface PythonRuntimeExtraData {
    pythonPath: string;
    ipykernelBundle?: IpykernelBundle;
    externallyManaged?: boolean;
    supported?: boolean;
    /** Module metadata for interpreters discovered via environment modules */
    moduleMetadata?: PythonModuleMetadata;
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

    // Get the workspace URI for scoping settings.
    const workspaceUri = workspaceService.workspaceFolders?.[0]?.uri;

    // Check Python kernel debug and log level settings
    // NOTE: We may need to pass a resource to getSettings to support multi-root workspaces
    traceInfo('createPythonRuntime: getting extension runtime settings');

    // Check if we should use the bundled ipykernel.
    const ipykernelBundle = await getIpykernelBundle(interpreter, serviceContainer, workspaceUri);

    // Determine if a compatible version of ipykernel is available (either bundled or already installed).
    let hasCompatibleKernel: boolean;
    if (ipykernelBundle.disabledReason) {
        traceInfo(
            `createPythonRuntime: ipykernel bundling is disabled ` +
                `(reason: ${ipykernelBundle.disabledReason}). ` +
                `Checking if ipykernel is installed`,
        );
        const productInstallStatus = await installer.isProductVersionCompatible(
            Product.ipykernel,
            IPYKERNEL_VERSION,
            interpreter,
        );
        hasCompatibleKernel = productInstallStatus === ProductInstallStatus.Installed;
        if (hasCompatibleKernel) {
            traceInfo(`createPythonRuntime: ipykernel installed`);
        } else {
            traceInfo('createPythonRuntime: ipykernel not installed');
        }
    } else {
        hasCompatibleKernel = true;
    }

    // Define the startup behavior; request immediate startup if this is the
    // recommended runtime for the workspace. Do not request immediate or implicit startup
    // if ipykernel (min version 6.19.1) is not installed -- the user should start runtime explicitly.
    let startupBehavior;
    if (hasCompatibleKernel) {
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
    const pythonVersion = interpreter.sysVersion?.split(' ')[0] || interpreter.version?.raw || '0.0.1';
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

    let supportedFlag = '';
    if (!isVersionSupported(interpreter.version)) {
        supportedFlag = `Unsupported: `;
    }

    const runtimeName = `${supportedFlag}Python ${runtimeShortName}`;

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
        ipykernelBundle,
        supported: isVersionSupported(interpreter.version),
    };

    // Check if this interpreter was discovered via environment modules
    const moduleMetadata = moduleMetadataMap.get(interpreter.path);
    if (moduleMetadata) {
        extraRuntimeData.moduleMetadata = moduleMetadata;
        traceInfo(`createPythonRuntime: interpreter from module environment "${moduleMetadata.environmentName}"`);
    }

    // Check the kernel supervisor's configuration; if it's  configured to
    // persist sessions, mark the session location as 'machine' so that
    // Positron will reattach to the session after Positron is reopened.
    const config = vscode.workspace.getConfiguration('kernelSupervisor');
    const sessionLocation =
        config.get<string>('shutdownTimeout', 'immediately') !== 'immediately'
            ? positron.LanguageRuntimeSessionLocation.Machine
            : positron.LanguageRuntimeSessionLocation.Workspace;

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
        sessionLocation,
        extraRuntimeData,
    };

    return metadata;
}
