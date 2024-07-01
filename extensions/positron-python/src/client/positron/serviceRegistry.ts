/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IServiceManager } from '../ioc/types';
import { IPythonRuntimeManager, PythonRuntimeManager } from './manager';

export function registerPositronTypes(serviceManager: IServiceManager): void {
    serviceManager.addSingleton<IPythonRuntimeManager>(IPythonRuntimeManager, PythonRuntimeManager);
}
