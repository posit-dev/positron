/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { TestInstantiationService } from '../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IErrorActionTargetService } from '../../../workbench/contrib/positronAssistant/common/errorActionTargets.js';

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
export function stubReactServices(svc: TestInstantiationService): void {
	// Read by useErrorActionTarget, which the console, notebook, and Quarto
	// error quick fixes call. No contributed target: errors go to Posit Assistant.
	svc.stub(IErrorActionTargetService, {
		onDidChange: Event.None,
		targets: [],
		getConfiguredTarget: () => undefined,
		run: async () => { },
	});
}
