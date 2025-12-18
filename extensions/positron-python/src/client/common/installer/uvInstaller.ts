/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable class-methods-use-this */

import { inject, injectable } from 'inversify';
import * as path from 'path';
import { ModuleInstallerType } from '../../pythonEnvironments/info';
import { ExecutionInfo, IConfigurationService, Product } from '../types';
import { ModuleInstaller, translateProductToModule } from './moduleInstaller';
import { InterpreterUri, ModuleInstallFlags } from './types';
import { isUvInstalled } from '../../pythonEnvironments/common/environmentManagers/uv';
import { IServiceContainer } from '../../ioc/types';
import { isResource } from '../utils/misc';
import { IWorkspaceService } from '../application/types';
import { IInterpreterService } from '../../interpreter/contracts';
import { IFileSystem } from '../platform/types';

@injectable()
export class UVInstaller extends ModuleInstaller {
    constructor(@inject(IServiceContainer) serviceContainer: IServiceContainer) {
        super(serviceContainer);
    }

    public get name(): string {
        return 'Uv';
    }

    public get displayName(): string {
        return 'uv';
    }

    public get type(): ModuleInstallerType {
        return ModuleInstallerType.Uv;
    }

    public get priority(): number {
        return 30;
    }

    public async isSupported(_resource?: InterpreterUri): Promise<boolean> {
        // uv can be used in any environment type
        try {
            return await isUvInstalled();
        } catch {
            return false;
        }
    }

    protected async getExecutionInfo(
        moduleName: string,
        resource?: InterpreterUri,
        flags: ModuleInstallFlags = 0,
    ): Promise<ExecutionInfo> {
        // If the resource isSupported, then the uv binary exists
        const execPath = 'uv';

        // Don't use 'uv add' for ipykernel since it's only being used to enable the Console
        const isIpykernel = moduleName === translateProductToModule(Product.ipykernel);

        // ...or if we're trying to break system packages
        const isBreakingSystemPackages = (flags & ModuleInstallFlags.breakSystemPackages) !== 0;

        // ...or if pyproject.toml doesn't exist at the workspace root
        const workspaceService = this.serviceContainer.get<IWorkspaceService>(IWorkspaceService);
        const fileSystem = this.serviceContainer.get<IFileSystem>(IFileSystem);
        let workspaceFolder = isResource(resource) ? workspaceService.getWorkspaceFolder(resource) : undefined;
        if (!workspaceFolder && workspaceService.workspaceFolders && workspaceService.workspaceFolders.length > 0) {
            workspaceFolder = workspaceService.workspaceFolders[0];
        }
        const pyprojectPath = workspaceFolder ? path.join(workspaceFolder.uri.fsPath, 'pyproject.toml') : undefined;
        const pyprojectExists = pyprojectPath ? await fileSystem.fileExists(pyprojectPath) : false;

        const usePyprojectWorkflow =
            !isIpykernel &&
            !isBreakingSystemPackages &&
            pyprojectExists;

        // Get the path to the python interpreter (similar to a part in ModuleInstaller.installModule())
        const configService = this.serviceContainer.get<IConfigurationService>(IConfigurationService);
        const settings = configService.getSettings(isResource(resource) ? resource : undefined);
        const interpreterService = this.serviceContainer.get<IInterpreterService>(IInterpreterService);
        const interpreter = isResource(resource) ? await interpreterService.getActiveInterpreter(resource) : resource;
        const interpreterPath = interpreter?.path ?? settings.pythonPath;
        const pythonPath = isResource(resource) ? interpreterPath : resource.path;

        const args: string[] = [];

        if (usePyprojectWorkflow) {
            // Use 'uv add' for project-based workflow
            args.push('add');
        } else {
            // Use 'uv pip install' for environment-based workflow
            args.push('pip', 'install');

            // Support the --break-system-packages flag to temporarily work around PEP 668.
            if (isBreakingSystemPackages) {
                args.push('--break-system-packages');
            }
        }
        args.push('--upgrade', '--python', pythonPath);

        return {
            args: [...args, moduleName],
            execPath,
        };
    }
}
