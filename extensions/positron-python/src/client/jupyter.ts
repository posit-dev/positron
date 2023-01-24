/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { Disposable } from 'vscode-languageclient';
import { IDiscoveryAPI } from './pythonEnvironments/base/locator';
import { PythonEnvInfo } from './pythonEnvironments/base/info';
import { IServiceContainer } from '../client/ioc/types';
import { IPythonExecutionFactory } from './common/process/types';
import { getVersionString } from './common/utils/version';
import { traceError } from './logging';
import { compare } from 'semver';

let runtime: positron.LanguageRuntime;

type PythonAdapterInfo = {
    env: PythonEnvInfo,
    hasKernel: boolean
}

export async function registerRuntimes(context: vscode.ExtensionContext, serviceContainer: IServiceContainer, api: IDiscoveryAPI): Promise<void> {

    // Check to see whether the Jupyter Adapter extension is installed
    // and active. If so, we can start the language server.
    const ext = vscode.extensions.getExtension('vscode.jupyter-adapter');
    if (!ext) {
        vscode.window.showErrorMessage('Could not find Jupyter Adapter extension to register Python runtimes.');
        return;
    }

    // Search for Python environments
    const envs: PythonAdapterInfo[] = await findPythonEnvs(serviceContainer, api);
    if (envs.length == 0) {
        vscode.window.showErrorMessage('Unable to locate any python environments for Positron');
        return;
    }

    // Register Python environments as potential Jupyter runtimes
    for (let env of envs) {
        adaptJupyterKernel(context, ext, env);
    }
}

async function findPythonEnvs(serviceContainer: IServiceContainer, api: IDiscoveryAPI): Promise<PythonAdapterInfo[]> {

    const pythonFactory = serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);

    // Sort available Python environments by version, but prioritize those with ipykernel already installed
    const kernelEnvs: PythonAdapterInfo[] = [];
    const otherEnvs: PythonAdapterInfo[] = [];
    for (let env of api.getEnvs()) {
        try {
            let pythonService = await pythonFactory.create({ pythonPath: env.executable.filename });
            let hasIpykernel = await pythonService.isModuleInstalled('ipykernel');
            let envInfo = { env: env, hasKernel: hasIpykernel };
            if (hasIpykernel) {
                kernelEnvs.push(envInfo);
            } else {
                otherEnvs.push(envInfo);
            }
        } catch (ex) {
            traceError(`Skipping python ${env.display} due to error`, ex);
        }
    }
    sortEnvs(kernelEnvs);
    sortEnvs(otherEnvs);

    return kernelEnvs.concat(otherEnvs);
}

// Modifies the given array by sorting Python environments in descending version order
function sortEnvs(envs: PythonAdapterInfo[]): void {
    envs.sort((a, b) => {
        const av: string = getVersionString(a.env.version);
        const bv: string = getVersionString(b.env.version);
        return -compare(av, bv); // Descending order
    });
}

// Register a Python with IPyKernel as a runtime for Positron
function adaptJupyterKernel(context: vscode.ExtensionContext, ext: vscode.Extension<any>, pythonInfo: PythonAdapterInfo): void {
    withActiveExtension(ext, () => {
        const disposable = registerKernelRuntime(ext!, context, pythonInfo);
        context.subscriptions.push(disposable);
    });
}

function registerKernelRuntime(ext: vscode.Extension<any>, _context: vscode.ExtensionContext, pythonInfo: PythonAdapterInfo): vscode.Disposable {

    // Create a kernel spec for this Python installation
    const kernelSpec = {
        argv: [pythonInfo.env.executable.filename, '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
        display_name: `${pythonInfo.env.display} (ipykernel)`,
        language: 'Python',
        metadata: {
            debugger: false
        }
    };
    const pythonVersion = getVersionString(pythonInfo.env.version);

    // Get the version of this extension from package.json so we can pass it
    // to the adapter as the implementation version.
    const packageJson = require('../../package.json');
    const extensionVersion = packageJson.version;

    // Create an adapter for the kernel to fulfill the LanguageRuntime interface
    const startupBehavior = pythonInfo.hasKernel ? positron.LanguageRuntimeStartupBehavior.Implicit : positron.LanguageRuntimeStartupBehavior.Explicit;
    runtime = ext.exports.adaptKernel(kernelSpec, 'python', pythonVersion, extensionVersion, null, startupBehavior); // TODO: Activate LSP

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
