/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import * as path from 'path';

import { IServiceContainer } from '../ioc/types';
import { IInterpreterService } from '../interpreter/contracts';
import { traceInfo, traceError } from '../logging';
import { EnvironmentType } from '../pythonEnvironments/info';
import { isProblematicCondaEnvironment } from '../interpreter/configuration/environmentTypeComparer';
import { IInstaller, Product, InstallerResponse } from '../common/types';
import { getCondaInterpreterPath } from '../pythonEnvironments/common/environmentManagers/conda';
import { IPythonRuntimeManager } from './manager';

interface CondaPythonInstallResult {
    installed: boolean;
    actualPythonPath?: string;
}

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
        const interpreterService = this.serviceContainer.get<IInterpreterService>(IInterpreterService);
        const items: positron.runtime.RuntimePickerItem[] = [];

        try {
            const allInterpreters = await interpreterService.getInterpreters();

            for (const interpreter of allInterpreters) {
                if (interpreter.envType !== EnvironmentType.Conda || !isProblematicCondaEnvironment(interpreter)) {
                    continue;
                }

                let envName = interpreter.envName || '';
                if (envName === '.conda' && interpreter.path) {
                    const condaDir = path.dirname(path.dirname(interpreter.path));
                    const projectDir = path.dirname(condaDir);
                    envName = path.basename(projectDir);
                }

                const envPath = interpreter.envPath || path.dirname(path.dirname(interpreter.path));

                items.push({
                    id: envPath,
                    label: `$(add) Install Python${envName ? ` in ${envName}` : ' in conda environment'}`,
                    detail: `Install Python in conda env: ${envPath}`,
                    separatorLabel: items.length === 0 ? 'Install Python' : undefined,
                });
            }
        } catch (error) {
            traceError(`Failed to get conda environments without Python: ${error}`);
        }

        traceInfo(`CondaPythonPickerContribution returning ${items.length} items`);
        return items;
    }

    async onDidSelectItem(itemId: string): Promise<string | undefined> {
        const envName = path.basename(itemId);

        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Installing Python in conda environment: ${envName}`,
            },
            async () => {
                try {
                    const predictedPythonPath = path.join(itemId, 'python');
                    const result = await this.installPythonInCondaEnv(predictedPythonPath);

                    if (!result.installed || !result.actualPythonPath) {
                        traceError('Python installation failed or interpreter not found');
                        vscode.window.showErrorMessage(`Failed to install Python in conda environment: ${envName}`);
                        return undefined;
                    }

                    traceInfo(`Python installed successfully at: ${result.actualPythonPath}`);

                    // Refresh so the interpreter service picks up the newly installed Python
                    // and returns fresh details (version, path) instead of stale cached data.
                    const interpreterService = this.serviceContainer.get<IInterpreterService>(IInterpreterService);
                    await interpreterService.triggerRefresh();
                    await interpreterService.refreshPromise;

                    const runtimeManager = this.serviceContainer.get<IPythonRuntimeManager>(IPythonRuntimeManager);
                    const metadata = await runtimeManager.registerLanguageRuntimeFromPath(result.actualPythonPath);

                    if (metadata) {
                        return metadata.runtimeId;
                    }

                    traceError(`Failed to register runtime for: ${result.actualPythonPath}`);
                    return undefined;
                } catch (error) {
                    traceError(`Failed to install Python: ${error}`);
                    vscode.window.showErrorMessage(
                        `Failed to install Python in conda environment: ${envName}. Error: ${error}`,
                    );
                    return undefined;
                }
            },
        );
    }

    private async installPythonInCondaEnv(pythonPath: string): Promise<CondaPythonInstallResult> {
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

        const actualPythonPath = getCondaInterpreterPath(interpreter.envPath);
        return { installed: true, actualPythonPath };
    }
}
