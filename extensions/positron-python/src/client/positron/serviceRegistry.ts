/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IServiceManager } from '../ioc/types';
import { IPythonRuntimeManager, PythonRuntimeManager } from './manager';

export function registerPositronTypes(serviceManager: IServiceManager): void {
    serviceManager.addSingleton<IPythonRuntimeManager>(IPythonRuntimeManager, PythonRuntimeManager);
}
