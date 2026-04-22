/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../base/common/lifecycle.js';
import { TestInstantiationService } from '../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { positronWorkbenchInstantiationService } from '../../../workbench/test/browser/positronWorkbenchTestServices.js';

/**
 * Workbench preset: the full 124+ Positron workbench service stack. Includes
 * runtime and notebook services. Use for tests that exercise workbench-level
 * behavior (contributions, services with many dependencies, etc.).
 */
export function createWorkbenchContainer(disposables: Pick<DisposableStore, 'add'>): TestInstantiationService {
	return positronWorkbenchInstantiationService(disposables);
}
