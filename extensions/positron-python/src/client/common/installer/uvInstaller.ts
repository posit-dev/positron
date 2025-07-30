/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable class-methods-use-this */

import { inject, injectable } from 'inversify';
import { ModuleInstallerType } from '../../pythonEnvironments/info';
import { ExecutionInfo, IConfigurationService } from '../types';
import { ModuleInstaller } from './moduleInstaller';
import { InterpreterUri } from './types';
import { isUvInstalled } from '../../pythonEnvironments/common/environmentManagers/uv';
import { IServiceContainer } from '../../ioc/types';
import { isResource } from '../utils/misc';
import { getEnvPath } from '../../pythonEnvironments/base/info/env';

@injectable()
export class UVInstaller extends ModuleInstaller {
    constructor(
        @inject(IServiceContainer) serviceContainer: IServiceContainer,
        @inject(IConfigurationService) private readonly configurationService: IConfigurationService,
    ) {
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

    protected async getExecutionInfo(moduleName: string, resource?: InterpreterUri): Promise<ExecutionInfo> {
        const pythonPath = isResource(resource)
            ? this.configurationService.getSettings(resource).pythonPath
            : resource
            ? getEnvPath(resource.path, resource.envPath).path ?? ''
            : '';

        // If the resource isSupported, then the uv binary exists
        const execPath = 'uv';
        const args = ['pip', 'install', '--python', pythonPath, moduleName];
        // TODO: should we use uv add if a pyproject.toml exists?

        return {
            args,
            execPath,
        };
    }
}
