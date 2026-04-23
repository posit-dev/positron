/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../base/common/lifecycle.js';
import { ServiceCollection } from '../../../platform/instantiation/common/serviceCollection.js';
import { TestInstantiationService } from '../../../platform/instantiation/test/common/instantiationServiceMock.js';

/**
 * Bare preset: empty instantiation service with no wired services.
 * Use for pure-logic tests that need the DI container shape but no services.
 */
export function createBareContainer(disposables: Pick<DisposableStore, 'add'>): TestInstantiationService {
	return disposables.add(new TestInstantiationService(new ServiceCollection()));
}
