/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../base/common/lifecycle.js';
import { TestInstantiationService } from '../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ErrorActionsService } from '../../../workbench/contrib/positronAssistant/browser/errorActionsService.js';
import { IErrorActionsService } from '../../../workbench/contrib/positronAssistant/common/errorActions.js';

/**
 * React services layer: stubs needed to construct PositronReactServices on
 * top of a workbench-level container, plus services that shared React hooks
 * read via `services.get()`. Applied additively -- stackable with
 * stubContributionServices.
 *
 * The workbench preset provides every service that PositronReactServices
 * itself needs. If a new Positron-specific service is added to
 * PositronReactServices and the canary test in positronTestContainer.vitest.ts
 * fails, add an empty stub here:
 *   svc.stub(INewService, {});
 */
export function stubReactServices(svc: TestInstantiationService, disposables: Pick<DisposableStore, 'add'>): void {
	// Read by useErrorActionHandler, which the console, notebook, and Quarto
	// error quick fixes call. No handlers are registered, so the quick fixes
	// hide; tests that need one register it after their own stubs apply.
	svc.stub(IErrorActionsService, disposables.add(svc.createInstance(ErrorActionsService)));
}
