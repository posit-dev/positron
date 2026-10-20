/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { TestInstantiationService } from '../../../platform/instantiation/test/common/instantiationServiceMock.js';

/**
 * React services layer: stubs needed to construct PositronReactServices on
 * top of a workbench-level container. Applied additively — stackable with
 * stubContributionServices.
 *
 * The workbench preset currently provides every service that
 * PositronReactServices needs, so this layer is a no-op. If a new
 * Positron-specific service is added to PositronReactServices and the canary
 * test in positronTestContainer.vitest.ts fails, add an empty stub here:
 *   svc.stub(INewService, {});
 */
// _svc is the extension point for future stubs; kept to document the contract.
export function stubReactServices(_svc: TestInstantiationService): void {
	// Intentionally empty. See JSDoc above.
}
