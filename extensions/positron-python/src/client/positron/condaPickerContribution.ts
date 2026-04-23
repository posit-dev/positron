/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import * as path from 'path';

import { IServiceContainer } from '../ioc/types';
import { IInterpreterService } from '../interpreter/contracts';
import { traceInfo, traceError } from '../logging';
import { EnvironmentType } from '../pythonEnvironments/info';
import { IPythonRuntimeManager, PythonRuntimeManager, CondaPythonInstallResult } from './manager';
import { createPythonRuntimeMetadata } from './runtime';
import { IInstaller, Product, InstallerResponse } from '../common/types';

/**
 * RuntimePickerContribution that provides "Install Python" options for conda environments
 * that don't have Python installed. This avoids caching issues by dynamically generating
 * picker items instead of registering them as runtimes.
 */
export class CondaPythonPickerContribution implements positron.runtime.RuntimePickerContribution {
    public readonly languageId = 'python';

    constructor(private readonly serviceContainer: IServiceContainer) {
        traceInfo(`CondaPythonPickerContribution created for language: ${this.languageId}`);
    }

    async getItems(): Promise<positron.runtime.RuntimePickerItem[]> {
        traceInfo(`CondaPythonPickerContribution.getItems() called`);
        const interpreterService = this.serviceContainer.get<IInterpreterService>(IInterpreterService);
        const items: positron.runtime.RuntimePickerItem[] = [];

        try {
            // Get all interpreters, including ones without Python installed
            const allInterpreters = await interpreterService.getInterpreters();
            traceInfo(`Found ${allInterpreters.length} total interpreters`);

            for (const interpreter of allInterpreters) {
                traceInfo(`Checking interpreter: ${interpreter.path}, envType: ${interpreter.envType}, exists: ${fs.existsSync(interpreter.path)}`);

                // Only handle conda environments without Python
                if (interpreter.envType === EnvironmentType.Conda && !fs.existsSync(interpreter.path)) {
                    traceInfo(`Found conda env without Python: ${interpreter.path}`);

                    // Get environment name for display
                    let envName = interpreter.envName || '';
                    if (envName === '.conda' && interpreter.path) {
                        // For .conda folders, use the parent directory name
                        const condaDir = path.dirname(path.dirname(interpreter.path));
                        const projectDir = path.dirname(condaDir);
                        envName = path.basename(projectDir);
                    }

                    // Use the environment path instead of the predicted python path
                    // This ensures we use the correct path for installation
                    const envPath = interpreter.envPath || path.dirname(path.dirname(interpreter.path));

                    const item = {
                        id: envPath, // Use environment path, not predicted python path
                        label: `$(add) Install Python${envName ? ` in ${envName}` : ' in conda environment'}`,
                        detail: `Install Python in conda env: ${envPath}`,
                        separatorLabel: items.length === 0 ? 'Install Python' : undefined
                    };

                    traceInfo(`Adding picker item: ${item.label}`);
                    items.push(item);
                }
            }
        } catch (error) {
            traceError(`Failed to get conda environments without Python: ${error}`);
        }

        traceInfo(`CondaPythonPickerContribution returning ${items.length} items`);
        return items;
    }

    async onDidSelectItem(itemId: string): Promise<string | undefined> {
        // Get environment name for notifications
        const envName = path.basename(itemId);

        try {
            traceInfo(`Installing Python in conda environment: ${itemId}`);

            // Show notification that installation is starting
            vscode.window.showInformationMessage(`Installing Python in conda environment: ${envName}...`);

            // itemId is now the environment path, we need to construct the predicted python path
            const predictedPythonPath = path.join(itemId, 'python');
            traceInfo(`Using predicted python path: ${predictedPythonPath}`);

            // Install Python in the conda environment (with notification instead of status bar)
            const result = await this.installPythonInCondaEnvQuiet(predictedPythonPath);

            if (result.installed && result.actualPythonPath) {
                traceInfo(`Python installed successfully at: ${result.actualPythonPath}`);

                // Get the interpreter details for the newly installed Python
                const interpreterService = this.serviceContainer.get<IInterpreterService>(IInterpreterService);
                const interpreter = await interpreterService.getInterpreterDetails(result.actualPythonPath);

                if (interpreter) {
                    // Create and register the new runtime directly
                    const newMetadata = await createPythonRuntimeMetadata(interpreter, this.serviceContainer, false);

                    // Get the Python runtime manager to register the new runtime
                    const runtimeManager = this.serviceContainer.get<IPythonRuntimeManager>(IPythonRuntimeManager) as PythonRuntimeManager;
                    runtimeManager.registerLanguageRuntime(newMetadata);

                    traceInfo(`Registered new Python runtime: ${newMetadata.runtimeId}`);

                    // Show success notification
                    vscode.window.showInformationMessage(`✅ Python successfully installed in conda environment: ${envName}`);

                    return newMetadata.runtimeId;
                }
            }

            traceError('Python installation failed or interpreter not found');
            vscode.window.showErrorMessage(`❌ Failed to install Python in conda environment: ${envName}`);
            return undefined;

        } catch (error) {
            traceError(`Failed to install Python: ${error}`);
            vscode.window.showErrorMessage(`❌ Failed to install Python in conda environment: ${envName}. Error: ${error}`);
            return undefined;
        }
    }

    /**
     * Install Python in conda environment without showing progress in status bar
     */
    private async installPythonInCondaEnvQuiet(pythonPath: string): Promise<CondaPythonInstallResult> {
        const interpreterService = this.serviceContainer.get<IInterpreterService>(IInterpreterService);
        const interpreter = await interpreterService.getInterpreterDetails(pythonPath);

        if (!interpreter?.envPath) {
            return { installed: false };
        }

        const installer = this.serviceContainer.get<IInstaller>(IInstaller);

        // Install without progress indicator (no withProgress wrapper)
        const installResult = await installer.install(Product.python, interpreter);

        if (installResult !== InstallerResponse.Installed) {
            return { installed: false };
        }

        // Note: Positron will automatically call "Discover All Interpreters" after this
        // function returns a runtime ID, so we don't need to manually trigger refresh

        // Get the actual Python path (same logic as original function)
        const actualPythonPath = this.getCondaPythonPath(interpreter.envPath);
        return { installed: true, actualPythonPath };
    }

    /**
     * Get the actual Python executable path for a conda environment.
     */
    private getCondaPythonPath(envPath: string | undefined): string | undefined {
        if (!envPath) {
            return undefined;
        }
        if (process.platform === 'win32') {
            const pythonPath = path.join(envPath, 'python.exe');
            return fs.existsSync(pythonPath) ? pythonPath : undefined;
        }
        // On Unix, try 'python' first, then 'python3'
        const pythonPath = path.join(envPath, 'bin', 'python');
        if (fs.existsSync(pythonPath)) {
            return pythonPath;
        }
        const python3Path = path.join(envPath, 'bin', 'python3');
        if (fs.existsSync(python3Path)) {
            return python3Path;
        }
        return undefined;
    }
}
