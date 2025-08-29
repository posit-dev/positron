/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { IServiceContainer } from '../../client/ioc/types';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { IPythonExecutionFactory } from '../../client/common/process/types';
import { PythonRuntimeSession } from '../../client/positron/session';

export function registerPythonLanguageModelTools(
    context: vscode.ExtensionContext,
    serviceContainer: IServiceContainer,
): void {
    const pythonLoadedPackagesTool = vscode.lm.registerTool<{ sessionIdentifier: string }>(
        'getAttachedPythonPackages',
        {
            invoke: async (options, _token) => {
                let session: positron.BaseLanguageRuntimeSession | undefined;
                if (options.input.sessionIdentifier) {
                    session = await positron.runtime.getSession(options.input.sessionIdentifier);
                    if (!session) {
                        session = await positron.runtime.getForegroundSession();
                    }
                } else {
                    session = await positron.runtime.getForegroundSession();
                }

                if (!session) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart('No active session found'),
                    ]);
                }
                if (session.runtimeMetadata.languageId !== 'python') {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart('Session is not a Python session'),
                    ]);
                }

                const result = await (session as PythonRuntimeSession).callMethod('getLoadedModules');
                if (Array.isArray(result) && result.length > 0) {
                    const moduleResults = result.map((module: string) => new vscode.LanguageModelTextPart(module));
                    return new vscode.LanguageModelToolResult(moduleResults);
                } else {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart('No Python packages loaded in the current session'),
                    ]);
                }
            },
        },
    );
    context.subscriptions.push(pythonLoadedPackagesTool);

    const pythonPackageVersionTool = vscode.lm.registerTool<{ paramName: string }>('getInstalledPythonPackageVersion', {
        invoke: async (options, _token) => {
            const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
            const activeInterpreter = await interpreterService.getActiveInterpreter();
            if (!activeInterpreter) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart('No active Python interpreter'),
                ]);
            }

            const pythonExecutionFactory = serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);
            const pythonExecution = await pythonExecutionFactory.createActivatedEnvironment({
                interpreter: activeInterpreter,
            });

            if (!options.input.paramName) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart('Package name is required'),
                ]);
            }

            const script = `
import json
import importlib.metadata
try:
    version = importlib.metadata.version("${options.input.paramName}")
    print(json.dumps(version))
except importlib.metadata.PackageNotFoundError:
    print(json.dumps(None))
`;
            const result = await pythonExecution.exec(['-c', script], {
                throwOnStdErr: false,
            });
            if (result.stdout) {
                try {
                    const version = JSON.parse(result.stdout.trim());
                    if (version === null) {
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart('Package not found'),
                        ]);
                    } else {
                        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(version)]);
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
        },
    });
    context.subscriptions.push(pythonPackageVersionTool);
}
