// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import { IPlatformService } from '../../common/platform/types';
import { IServiceContainer } from '../../ioc/types';
import { DebugOptions } from '../Common/Contracts';
import { BaseConfigurationProvider, PythonDebugConfiguration } from './baseProvider';

@injectable()
export class PythonV2DebugConfigurationProvider extends BaseConfigurationProvider {
    constructor(@inject(IServiceContainer) serviceContainer: IServiceContainer) {
        super('pythonExperimental', serviceContainer);
    }
    protected provideDefaults(workspaceFolder: Uri, debugConfiguration: PythonDebugConfiguration): void {
        super.provideDefaults(workspaceFolder, debugConfiguration);

        debugConfiguration.stopOnEntry = false;
        debugConfiguration.debugOptions = Array.isArray(debugConfiguration.debugOptions) ? debugConfiguration.debugOptions : [];

        // Add PTVSD specific flags.
        if (this.serviceContainer.get<IPlatformService>(IPlatformService).isWindows) {
            debugConfiguration.debugOptions.push(DebugOptions.FixFilePathCase);
        }
        if (debugConfiguration.module && debugConfiguration.module.toUpperCase() === 'FLASK'
            && debugConfiguration.debugOptions.indexOf(DebugOptions.Flask) === -1) {
            debugConfiguration.debugOptions.push(DebugOptions.Flask);
        }
    }
}
