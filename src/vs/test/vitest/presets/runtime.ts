/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../base/common/lifecycle.js';
import { ServiceCollection } from '../../../platform/instantiation/common/serviceCollection.js';
import { TestInstantiationService } from '../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { createRuntimeServices } from '../../../workbench/services/runtimeSession/test/common/testRuntimeSessionService.js';

/**
 * Runtime preset: adds the 18 runtime/language services
 * (ILanguageRuntimeService, IRuntimeSessionService, etc.) on top of a bare
 * container. Use for tests that exercise runtime/session logic without the
 * full workbench stack.
 */
export function createRuntimeContainer(disposables: Pick<DisposableStore, 'add'>): TestInstantiationService {
	const svc = disposables.add(new TestInstantiationService(new ServiceCollection()));
	createRuntimeServices(svc, disposables);
	return svc;
}
