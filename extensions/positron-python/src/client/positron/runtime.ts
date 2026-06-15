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
import {
    ModuleMetadata,
    moduleMetadataMap,
    whenModuleMetadataReady,
} from '../pythonEnvironments/base/locators/lowLevel/moduleEnvironmentLocator';
import { getShortVersionString, parseVersion } from '../pythonEnvironments/base/info/pythonVersion';
import { EnvironmentType, virtualEnvTypes } from '../pythonEnvironments/info';
import { isParentPath } from '../pythonEnvironments/common/externalDependencies';

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

/**
 * Decide whether this interpreter should be eligible for Positron's cross-window
 * discovery cache. Cacheable runtimes are persisted across windows and short-circuit
 * full discovery on warm starts; project-bound or proxy/shim interpreters must be
 * rediscovered every open and so are excluded.
 */
function isPythonRuntimeCacheable(interpreter: PythonEnvironment, workspaceFolderPaths: string[]): boolean {
    // Need a real on-disk binary to fingerprint.
    if (!interpreter.path) {
        return false;
    }

    // Module-managed interpreters depend on environment-modules state that's loaded
    // at session start; the binary at `path` doesn't behave correctly without it.
    if (interpreter.envType === EnvironmentType.Module || moduleMetadataMap.has(interpreter.path)) {
        return false;
    }

    // Virtual envs (Venv, VirtualEnv, Poetry, Pipenv, Pixi, Uv, Hatch,
    // VirtualEnvWrapper) and ActiveState envs are project-scoped or workspace-bound.
    if (virtualEnvTypes.includes(interpreter.envType) || interpreter.envType === EnvironmentType.ActiveState) {
        return false;
    }

    // Pyenv/asdf shims aren't real binaries; their effective version is per-project.
    const shimSegment = `${path.sep}shims${path.sep}`;
    if (interpreter.path.includes(shimSegment)) {
        return false;
    }

    // Anything under a workspace folder is project-scoped (covers conda envs created
    // with `--prefix ./conda`, in-tree Pythons, etc.) regardless of envType.
    for (const folder of workspaceFolderPaths) {
        if (
            folder &&
            (isParentPath(interpreter.path, folder) ||
                (interpreter.envPath && isParentPath(interpreter.envPath, folder)))
        ) {
            return false;
        }
    }

    return true;
}

/**
 * Compute the display source and short name for a Python runtime (e.g. source
 * `Venv` and short name `3.10.17 (Venv: my-project)`).
 *
 * When module metadata is present it is authoritative for both: a module-managed
 * Python is often also visible to the native locator as a bare global, so the
 * interpreter's `envType` can be `Unknown` even though the runtime is
 * module-provided. Keying off the metadata keeps it labelled as `Module`
 * (mirroring classifyRRuntimeSource on the R side).
 *
 * @param interpreterPath The interpreter's executable path.
 * @param envType The environment type reported by discovery.
 * @param envName The environment name reported by discovery, if any.
 * @param pythonVersion The formatted Python version (e.g. '3.10.17').
 * @param moduleMetadata Module metadata for this interpreter, if module-provided.
 * @returns The runtime source and the short display name.
 */
export function getRuntimeSourceAndShortName(
    interpreterPath: string,
    envType: EnvironmentType,
    envName: string | undefined,
    pythonVersion: string,
    moduleMetadata: ModuleMetadata | undefined,
): { runtimeSource: EnvironmentType; runtimeShortName: string } {
    // Get the environment name, using parent directory name for .venv/.conda
    // folders (like uv does). Module environments use their configured name.
    let resolvedEnvName = envName ?? '';
    if (moduleMetadata) {
        resolvedEnvName = moduleMetadata.environmentName;
    } else if ((resolvedEnvName === '.venv' || resolvedEnvName === '.conda') && interpreterPath) {
        // interpreterPath is like /project/.venv/bin/python (Unix) or
        // /project/.venv/Scripts/python.exe (Windows); extract "project".
        const venvDir = path.dirname(path.dirname(interpreterPath)); // up from python to bin/Scripts, then to .venv
        const projectDir = path.dirname(venvDir); // up from .venv to project
        const projectName = path.basename(projectDir);
        if (projectName) {
            resolvedEnvName = projectName;
        }
    }

    const runtimeSource = moduleMetadata ? EnvironmentType.Module : envType;

    // Construct the display name for the runtime, like 'Python (Pyenv: venv-name)'.
    let runtimeShortName = pythonVersion;
    // Add the environment type (e.g. 'Pyenv', 'Global', 'Conda', etc.)
    runtimeShortName += ` (${runtimeSource}`;
    // Add the environment name if it's not the same as the Python version
    if (resolvedEnvName.length > 0 && resolvedEnvName !== pythonVersion) {
        runtimeShortName += `: ${resolvedEnvName}`;
    }
    runtimeShortName += ')';

    return { runtimeSource, runtimeShortName };
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
    // Use parseVersion + getShortVersionString to properly format the version (strips "final" suffix)
    const rawVersion = interpreter.sysVersion?.split(' ')[0] || interpreter.version?.raw || '0.0.1';
    const pythonVersion = getShortVersionString(parseVersion(rawVersion));

    // Check if this interpreter was discovered via environment modules. Module
    // discovery runs asynchronously, so wait for it to settle before reading the
    // path-keyed map: this function can run before discovery completes (e.g. via
    // the eager onDidChangeInterpreters registration), and reading the map too
    // early would mislabel a module-managed interpreter as a plain global.
    await whenModuleMetadataReady();
    const moduleMetadata = moduleMetadataMap.get(interpreter.path);

    // Determine the display source (e.g. 'Venv', 'Module') and short name.
    const { runtimeSource, runtimeShortName } = getRuntimeSourceAndShortName(
        interpreter.path,
        interpreter.envType,
        interpreter.envName,
        pythonVersion,
        moduleMetadata,
    );

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

    // Record the module metadata (looked up above) so the session launches with
    // the module environment loaded.
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

    // Determine whether this runtime is eligible for the discovery cache.
    const workspaceFolderPaths = (workspaceService.workspaceFolders ?? []).map((f) => f.uri.fsPath).filter((p) => !!p);
    const cacheable = isPythonRuntimeCacheable(interpreter, workspaceFolderPaths);

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
        cacheable,
    };

    return metadata;
}
