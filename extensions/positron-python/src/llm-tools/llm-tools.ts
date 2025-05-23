/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IServiceContainer } from '../client/ioc/types'
import { IInterpreterService } from '../client/interpreter/contracts';
import { traceInfo } from '../client/logging';
import { IPythonExecutionFactory } from '../client/common/process/types';

export function registerPythonLanguageModelTools(context: vscode.ExtensionContext, serviceContainer: IServiceContainer): void {
    const pythonLoadedPackagesTool = vscode.lm.registerTool<{}>('getAttachedPackages', {
        invoke: async (_options, _token) => {
            const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
            const activeInterpreter = await interpreterService.getActiveInterpreter();
            if (!activeInterpreter) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart('No active Python interpreter'),
                ]);
            }

            traceInfo(`pythonLoadedPackagesTool: active interpreter: ${activeInterpreter?.path}`);
            traceInfo(`pythonLoadedPackagesTool: discovering Python packages`);

            const pythonExecutionFactory = serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);
            const pythonExecution = await pythonExecutionFactory.createActivatedEnvironment({
                interpreter: activeInterpreter
            });

            const script = `
import json
import importlib.metadata
installed_packages = [f"{dist.metadata['Name']} ({dist.version})" for dist in importlib.metadata.distributions()]
print(json.dumps(installed_packages))
`;
            const result = await pythonExecution.exec(['-c', script], {
                throwOnStdErr: false
            });
            if (result.stdout) {
                try {
                    const packages = JSON.parse(result.stdout.trim());
                    if (Array.isArray(packages)) {
                        const results = packages.map((pkg: string) => new vscode.LanguageModelTextPart(pkg));
                        return new vscode.LanguageModelToolResult(results);
                    } else {
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart('Failed to retrieve installed packages'),
                        ]);
                    }
                } catch (parseError) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart('Failed to parse package list'),
                    ]);
                }
            } else {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart('No packages found in the active Python environment'),
                ]);
            }
        }
    });
    context.subscriptions.push(pythonLoadedPackagesTool);

    const pythonPackageVersionTool = vscode.lm.registerTool<{ packageName: string }>('getInstalledPackageVersion', {
        invoke: async (options, _token) => {
            const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
            const activeInterpreter = await interpreterService.getActiveInterpreter();
            if (!activeInterpreter) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart('No active Python interpreter'),
                ]);
            }

            traceInfo(`pythonPackageVersionTool: active interpreter: ${activeInterpreter?.path}`);
            traceInfo(`pythonPackageVersionTool: discovering Python packages`);

            const pythonExecutionFactory = serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);
            const pythonExecution = await pythonExecutionFactory.createActivatedEnvironment({
                interpreter: activeInterpreter
            });

            if (!options.input.packageName) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart('Package name is required'),
                ]);
            }

            const script = `
import json
import importlib.metadata
try:
    version = importlib.metadata.version("${options.input.packageName}")
    print(json.dumps(version))
except importlib.metadata.PackageNotFoundError:
    print(json.dumps(None))
`;
            const result = await pythonExecution.exec(['-c', script], {
                throwOnStdErr: false
            });
            if (result.stdout) {
                try {
                    const version = JSON.parse(result.stdout.trim());
                    if (version === null) {
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart('Package not found'),
                        ]);
                    } else {
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart(version),
                        ]);
                    }
                } catch (parseError) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart('Failed to parse package version'),
                    ]);
                }
            }
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No version found for the specified package'),
            ]);
        }
    });
    context.subscriptions.push(pythonPackageVersionTool);
}
