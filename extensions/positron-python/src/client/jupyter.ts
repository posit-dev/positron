/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { Disposable } from 'vscode-languageclient';
import { IDiscoveryAPI } from './pythonEnvironments/base/locator';
import { PythonEnvInfo } from './pythonEnvironments/base/info';
import { IServiceContainer } from '../client/ioc/types';
import { IPythonExecutionFactory, IPythonExecutionService } from './common/process/types';
import { getVersionString } from './common/utils/version';
import { traceError } from './logging';
import { compare } from 'semver';

let runtime: positron.LanguageRuntime;

const MIN_PYTHON2_MINOR_VERSION = 7;
const MIN_PYTHON3_MINOR_VERSION = 3;

export async function registerRuntimes(context: vscode.ExtensionContext, serviceContainer: IServiceContainer, api: IDiscoveryAPI): Promise<void> {

    // Search for a Python environment with an IPyKernel module
    const pythonEnv = await findSuitablePythonEnv(serviceContainer, api);
    if (!pythonEnv) {
        vscode.window.showErrorMessage(`Unable to locate a suitable python environment for Positron`);
        return;
    }

    // Register the IPyKernel-enabled python environment as a Jupyter runtime
    adaptJupyterKernel(context, pythonEnv);

    // TODO: Register potentially multiple suitable Python runtimes
}

async function findSuitablePythonEnv(serviceContainer: IServiceContainer, api: IDiscoveryAPI): Promise<PythonEnvInfo | undefined> {

    // First, check if a specific Python environment was configured for Positron
    const pythonConfig = vscode.workspace.getConfiguration('positron');
    let pythonPath = pythonConfig.get<string>('pythonPath');
    if (pythonPath) {
        return await api.resolveEnv(pythonPath);
    }

    // Otherwise, evaluate the available Python environments and return the latest version
    // that has the ipykernel module installed
    const pythonExecutionFactory = serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);

    // TODO: Determine the prioritization rules for selecting a Python environment
    const envs: PythonEnvInfo[] = sortEnvs(api.getEnvs());
    for (let env of envs) {
        try {
            pythonPath = env.executable.filename;
            let pythonExecutionService = await pythonExecutionFactory.create({ pythonPath: pythonPath });
            let suitableEnv = await isSuitableEnv(pythonExecutionService, env);

            if (suitableEnv) {
                return env;
            }
        } catch (ex) {
            traceError(`Skipping python ${env.display} due to error`, ex);
        }
    }
    return undefined;
}

// Check the Python environment version and if the IPyKernel module is installed
async function isSuitableEnv(service: IPythonExecutionService, env: PythonEnvInfo): Promise<boolean> {
    if ((env.version.major == 2 && env.version.minor >= MIN_PYTHON2_MINOR_VERSION) ||
        (env.version.major == 3 && env.version.minor >= MIN_PYTHON3_MINOR_VERSION)) {
        return await service.isModuleInstalled('ipykernel');
    }
    return false;
}

// Returns a sorted copy of the array of Python environments, in descending order
function sortEnvs(envs: PythonEnvInfo[]): PythonEnvInfo[] {
    const copy: PythonEnvInfo[] = [...envs];
    copy.sort((a, b) => {
        const av: string = getVersionString(a.version);
        const bv: string = getVersionString(b.version);
        return -compare(av, bv); // Descending order
    });
    return copy;
}

// Register a Python with IPyKernel as a runtime for Positron
function adaptJupyterKernel(context: vscode.ExtensionContext, pythonEnv: PythonEnvInfo): void {
    // Check to see whether the Jupyter Adapter extension is installed
    // and active. If so, we can start the language server.
    const ext = vscode.extensions.getExtension('vscode.jupyter-adapter');
    if (!ext) {
        vscode.window.showErrorMessage('Could not find Jupyter Adapter extension.');
        return;
    }

    withActiveExtension(ext, () => {
        const disposable = registerIPyKernelRuntime(ext!, context, pythonEnv);
        context.subscriptions.push(disposable);
    });
}

function registerIPyKernelRuntime(ext: vscode.Extension<any>, _context: vscode.ExtensionContext, pythonEnv: PythonEnvInfo): vscode.Disposable {

    // Create a kernel spec for this Python installation
    const kernelSpec = {
        argv: [pythonEnv.executable.filename, '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
        display_name: `${pythonEnv.display} (ipykernel)`,
        language: 'python',
        metadata: {
            debugger: false
        }
    };
    const version = getVersionString(pythonEnv.version);

    // Create an adapter for the kernel to fulfill the LanguageRuntime interface
    runtime = ext.exports.adaptKernel(kernelSpec, version, null); // TODO: Activate LSP

    // Register a language runtime provider for this kernel
    const disposable: vscode.Disposable = positron.runtime.registerLanguageRuntime(runtime);

    // Return a disposable that will dispose of the language runtime provider
    return Disposable.create(() => {
        disposable.dispose();
    });
}

function withActiveExtension(ext: vscode.Extension<any>, callback: () => void) {
    if (ext.isActive) {
        callback();
    } else {
        ext.activate().then(callback);
    }
}
