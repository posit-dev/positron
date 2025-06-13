/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Similar to createPythonFile.ts

import { injectable, inject } from 'inversify';
import { Uri, workspace } from 'vscode';
import * as path from 'path';
import { IExtensionSingleActivationService } from '../../../activation/types';
import { Commands } from '../../constants';
import { ICommandManager, IWorkspaceService } from '../types';
import { IDisposableRegistry } from '../../types';
import { MINIMUM_PYTHON_VERSION } from '../../constants';
import { traceError, traceInfo } from '../../../logging';

export type CreatePyprojectTomlResult = { success: true; path: string } | { success: false; error: string };

@injectable()
export class CreatePyprojectTomlCommandHandler implements IExtensionSingleActivationService {
    public readonly supportedWorkspaceTypes = { untrustedWorkspace: true, virtualWorkspace: true };

    constructor(
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
    ) {}

    public async activate(): Promise<void> {
        this.disposables.push(
            this.commandManager.registerCommand(Commands.Create_Pyproject_Toml, this.createPyprojectToml, this),
        );
    }

    public async createPyprojectToml(minPythonVersion?: string): Promise<CreatePyprojectTomlResult> {
        const workspaceFolder = this.workspaceService.workspaceFolders?.[0];
        if (!workspaceFolder) {
            traceError('No workspace folder found to create pyproject.toml');
            return { success: false, error: 'No workspace folder found' };
        }

        const workspaceName = path.basename(workspaceFolder.uri.fsPath);
        const pyprojectPath = Uri.joinPath(workspaceFolder.uri, 'pyproject.toml');
        if (!minPythonVersion) {
            minPythonVersion = MINIMUM_PYTHON_VERSION.raw;
        }

        try {
            await workspace.fs.stat(pyprojectPath);
            traceInfo(`pyproject.toml already exists in ${workspaceName}. No action taken.`);
            return { success: true, path: pyprojectPath.toString() };
        } catch {
            traceInfo(`Creating pyproject.toml in ${workspaceName}`);
        }

        try {
            const tomlContent = `[project]
name = "${workspaceName}"
version = "0.1.0"
requires-python = ">= ${minPythonVersion}"
dependencies = []
`;
            const contentBytes = new TextEncoder().encode(tomlContent);
            await workspace.fs.writeFile(pyprojectPath, contentBytes);
            return { success: true, path: pyprojectPath.toString() };
        } catch (error) {
            traceError(`Failed to create pyproject.toml in ${workspaceName}`, error);
            return {
                success: false,
                error: `Failed to create pyproject.toml: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }
}
