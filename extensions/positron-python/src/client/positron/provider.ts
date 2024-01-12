/* eslint-disable global-require */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as semver from 'semver';
import * as vscode from 'vscode';

import { PythonExtension } from '../api/types';
import { EXTENSION_ROOT_DIR, PYTHON_LANGUAGE } from '../common/constants';
import { IConfigurationService, IInstaller, Product } from '../common/types';
import { IServiceContainer } from '../ioc/types';
import { IInterpreterService } from '../interpreter/contracts';
import { JupyterKernelSpec } from '../jupyter-adapter.d';
import { traceError, traceInfo } from '../logging';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { PythonVersion } from '../pythonEnvironments/info/pythonVersion';
import { untildify } from '../pythonEnvironments/common/externalDependencies';
import { ILanguageServerOutputChannel } from '../activation/types';
import { PythonRuntime, createJupyterKernelExtra } from './runtime';
import { JediLanguageServerAnalysisOptions } from '../activation/jedi/analysisOptions';
import { IEnvironmentVariablesProvider } from '../common/variables/types';
import { IWorkspaceService } from '../common/application/types';

/**
 * Provides a single Python language runtime for Positron; implements
 * positron.LanguageRuntimeProvider.
 *
 * @param serviceContainer The Python extension's service container to use for dependency injection.
 */
export class PythonRuntimeProvider implements positron.LanguageRuntimeProvider {

    /**
     * Constructor.
     * @param serviceContainer The Python extension's service container to use for dependency injection.
     */
    constructor(
        private readonly serviceContainer: IServiceContainer,
        private readonly pythonApi: PythonExtension
    ) { }

    async provideLanguageRuntime(
        runtimeMetadata: positron.LanguageRuntimeMetadata,
        _token: vscode.CancellationToken
    ): Promise<positron.LanguageRuntime> {
        traceInfo('PythonRuntimeProvider: Providing a single Python runtime');
        const interpreterService = this.serviceContainer.get<IInterpreterService>(IInterpreterService);
        const interpreter = await interpreterService.getInterpreterDetails(
            untildify(runtimeMetadata.runtimePath));
        if (!interpreter) {
            throw new Error(`Cannot find Python interpreter for ${runtimeMetadata.runtimePath}`);
        }
        const runtime = await createPythonRuntime(interpreter, this.serviceContainer, true, this.pythonApi);
        return runtime;
    }
}

/**
 * Provides Python language runtimes to Positron; implements positron.LanguageRuntimeDiscoverer.
 *
 * @param serviceContainer The Python extension's service container to use for dependency injection.
 * @param runtimes A map from interpreter path to language runtime metadata.
 * @param activatedPromise Resolves when all Python extension components are activated.
 */
export async function* pythonRuntimeDiscoverer(
    serviceContainer: IServiceContainer,
    runtimes: Map<string, positron.LanguageRuntimeMetadata>,
    activatedPromise: Promise<void>,
    pythonApi: PythonExtension,
): AsyncGenerator<positron.LanguageRuntime> {
    try {
        traceInfo('pythonRuntimeDiscoverer: Starting Python runtime discoverer');

        // Wait for all extension components to be activated
        traceInfo('pythonRuntimeDiscoverer: awaiting extension activation');
        await activatedPromise;

        const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);

        // Get the preferred interpreter
        // NOTE: We may need to pass a resource to getSettings to support multi-root workspaces
        const preferredInterpreter = await interpreterService.getActiveInterpreter();

        // Discover Python interpreters
        let interpreters = interpreterService.getInterpreters();
        // Sort the available interpreters, favoring the active interpreter (if one is available)
        interpreters = sortInterpreters(interpreters, preferredInterpreter);

        traceInfo(`pythonRuntimeDiscoverer: discovered ${interpreters.length} Python interpreters`);
        traceInfo(`pythonRuntimeDiscoverer: preferred interpreter: ${preferredInterpreter?.path}`);

        // Recommend Python for the workspace if it contains Python-relevant files
        let recommendedForWorkspace = await hasFiles([
            // Code and notebook files
            '**/*.py',
            '**/*.ipynb',
            // Virtual environment folders
            '.venv/**/*',
            '.conda/**/*',
            // Config files
            'pyproject.toml',
            'Pipfile',
            '*requirements.txt',
            '.python-version',
            'environment.yml',
        ]);
        traceInfo(`pythonRuntimeDiscoverer: recommended for workspace: ${recommendedForWorkspace}`);

        // Register each interpreter as a language runtime
        for (const interpreter of interpreters) {
            // Only register runtimes for supported versions
            if (isVersionSupported(interpreter?.version, '3.8.0')) {
                const runtime = await createPythonRuntime(
                    interpreter,
                    serviceContainer,
                    recommendedForWorkspace,
                    pythonApi,
                );

                // Ensure we only recommend one runtime for the workspace.
                recommendedForWorkspace = false;

                traceInfo(
                    `pythonRuntimeDiscoverer: registering runtime for interpreter ${interpreter.path} with id ${runtime.metadata.runtimeId}`,
                );
                yield runtime;
                runtimes.set(interpreter.path, runtime.metadata);
            } else {
                traceInfo(`pythonRuntimeDiscoverer: skipping unsupported interpreter ${interpreter.path}`);
            }
        }
    } catch (ex) {
        traceError('pythonRuntimeDiscoverer() failed', ex);
    }
}

export async function createPythonRuntime(
    interpreter: PythonEnvironment,
    serviceContainer: IServiceContainer,
    recommendedForWorkspace: boolean,
    pythonApi: PythonExtension,
): Promise<PythonRuntime> {
    traceInfo('createPythonRuntime: getting service instances');
    const configService = serviceContainer.get<IConfigurationService>(IConfigurationService);
    const installer = serviceContainer.get<IInstaller>(IInstaller);
    const environmentService = serviceContainer.get<IEnvironmentVariablesProvider>(IEnvironmentVariablesProvider);
    const outputChannel = serviceContainer.get<ILanguageServerOutputChannel>(ILanguageServerOutputChannel);
    const workspaceService = serviceContainer.get<IWorkspaceService>(IWorkspaceService);

    // Check Python kernel debug and log level settings
    // NOTE: We may need to pass a resource to getSettings to support multi-root workspaces
    traceInfo('createPythonRuntime: getting extension runtime settings');
    const settings = configService.getSettings();
    const debug = settings.languageServerDebug;
    const logLevel = settings.languageServerLogLevel;
    const { quietMode } = settings;

    // If required, also locate an available port for the debugger
    traceInfo('createPythonRuntime: locating available debug port');
    const portfinder = require('portfinder');
    let debugPort;
    if (debug) {
        if (debugPort === undefined) {
            debugPort = 5678; // Default port for debugpy
        }
        debugPort = await portfinder.getPortPromise({ port: debugPort });
    }

    // Define the startup behavior; request immediate startup if this is the
    // recommended runtime for the workspace. Do not request immediate startup
    // if ipykernel is not installed -- the user should start runtime explicitly.
    let startupBehavior;
    if (recommendedForWorkspace) {
        traceInfo('createPythonRuntime: checking if ipykernel is installed');
        const hasKernel = await installer.isInstalled(Product.ipykernel, interpreter);
        startupBehavior = hasKernel
            ? positron.LanguageRuntimeStartupBehavior.Immediate
            : positron.LanguageRuntimeStartupBehavior.Explicit;
    } else {
        startupBehavior = positron.LanguageRuntimeStartupBehavior.Implicit;
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

    const command = interpreter.path;
    const lsScriptPath = path.join(EXTENSION_ROOT_DIR, 'pythonFiles', 'positron_language_server.py');
    const args = [
        command,
        lsScriptPath,
        '-f',
        '{connection_file}',
        '--logfile',
        '{log_file}',
        `--loglevel=${logLevel}`,
    ];
    if (debugPort) {
        args.push(`--debugport=${debugPort}`);
    }
    if (quietMode) {
        args.push('--quiet');
    }

    // Create a kernel spec for this Python installation
    const kernelSpec: JupyterKernelSpec = {
        argv: args,
        display_name: `${runtimeName}`,
        language: 'Python',
    };

    // Get the version of this extension from package.json so we can pass it
    // to the adapter as the implementation version.
    const packageJson = require('../../../../package.json');

    traceInfo(`createPythonRuntime: kernelSpec argv: ${args}`);

    // Create a stable ID for the runtime based on the interpreter path and version.
    const digest = crypto.createHash('sha256');
    digest.update(JSON.stringify(kernelSpec));
    digest.update(pythonVersion);
    const runtimeId = digest.digest('hex').substring(0, 32);

    // Create the runtime path.
    // TODO@softwarenerd - We will need to update this for Windows.
    const homedir = os.homedir();
    const runtimePath =
        os.platform() !== 'win32' && interpreter.path.startsWith(homedir)
            ? path.join('~', interpreter.path.substring(homedir.length))
            : interpreter.path;

    // Create the metadata for the language runtime
    const metadata: positron.LanguageRuntimeMetadata = {
        runtimeId,
        runtimeName,
        runtimeShortName,
        runtimePath,
        runtimeVersion: packageJson.version,
        runtimeSource,
        languageId: PYTHON_LANGUAGE,
        languageName: kernelSpec.language,
        languageVersion: pythonVersion,
        inputPrompt: '>>>',
        continuationPrompt: '...',
        base64EncodedIconSvg: fs
            .readFileSync(path.join(EXTENSION_ROOT_DIR, 'resources', 'branding', 'python-icon.svg'))
            .toString('base64'),
        startupBehavior,
    };

    // Create the initial config for the dynamic state of the language runtime
    const dynState: positron.LanguageRuntimeDynState = {
        inputPrompt: '>>>',
        continuationPrompt: '...',
    };

    // Get the current workspace resource
    const resource = workspaceService.workspaceFolders?.[0].uri;

    traceInfo(`createPythonRuntime: getting language server options`);
    const analysisOptions = new JediLanguageServerAnalysisOptions(
        environmentService,
        outputChannel,
        configService,
        workspaceService,
    );
    await analysisOptions.initialize(resource, interpreter);

    const languageClientOptions = await analysisOptions.getAnalysisOptions();

    const extra = createJupyterKernelExtra();

    // Create an adapter for the kernel to fulfill the LanguageRuntime interface.
    traceInfo(`createPythonRuntime: creating PythonRuntime`);
    return new PythonRuntime(
        serviceContainer,
        kernelSpec,
        metadata,
        dynState,
        languageClientOptions,
        interpreter,
        installer,
        pythonApi,
        extra,
    );
}

// Returns a sorted copy of the array of Python environments, in descending order
function sortInterpreters(
    interpreters: PythonEnvironment[],
    preferredInterpreter: PythonEnvironment | undefined,
): PythonEnvironment[] {
    const copy: PythonEnvironment[] = [...interpreters];
    copy.sort((a: PythonEnvironment, b: PythonEnvironment) => {
        // Favor preferred interpreter, if specified, in descending order
        if (preferredInterpreter) {
            if (preferredInterpreter.id === a.id) return -1;
            if (preferredInterpreter.id === b.id) return 1;
        }

        // Compare versions in descending order
        const av: string = getVersionString(a.version);
        const bv: string = getVersionString(b.version);
        return -semver.compare(av, bv);
    });
    return copy;
}

// Check if the current workspace contains files matching any of the passed glob ptaterns
async function hasFiles(includes: string[]): Promise<boolean> {
    // Create a single glob pattern e.g. ['a', 'b'] => '{a,b}'
    const include = `{${includes.join(',')}}`;
    // Exclude node_modules for performance reasons
    return (await vscode.workspace.findFiles(include, '**/node_modules/**', 1)).length > 0;
}

/**
 * Formats python version info as a semver string, adapted from
 * common/utils/version to work with PythonVersion instances.
 */
function getVersionString(info: PythonVersion | undefined): string {
    if (!info) {
        return '0';
    }
    if (info.major < 0) {
        return '';
    }
    if (info.minor < 0) {
        return `${info.major}`;
    }
    if (info.patch < 0) {
        return `${info.major}.${info.minor}`;
    }
    return `${info.major}.${info.minor}.${info.patch}`;
}

/**
 * Check if a version is supported (i.e. >= the minimum supported version).
 * Also returns true if the version could not be determined.
 */
function isVersionSupported(version: PythonVersion | undefined, minimumSupportedVersion: string): boolean {
    const versionString = version && getVersionString(version);
    return !versionString || semver.gte(versionString, minimumSupportedVersion);
}
