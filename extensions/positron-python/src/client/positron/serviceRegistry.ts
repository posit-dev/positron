/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionSingleActivationService } from '../activation/types';
import { CreatePyprojectTomlCommandHandler } from '../common/application/commands/createPyprojectToml';
import { IServiceManager } from '../ioc/types';
import { IPythonRuntimeManager, PythonRuntimeManager } from './manager';

export function registerPositronTypes(serviceManager: IServiceManager): void {
    serviceManager.addSingleton<IPythonRuntimeManager>(IPythonRuntimeManager, PythonRuntimeManager);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        CreatePyprojectTomlCommandHandler,
    );
}
