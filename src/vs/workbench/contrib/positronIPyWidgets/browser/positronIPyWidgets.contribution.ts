/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { PositronIPyWidgetsService } from 'vs/workbench/contrib/positronIPyWidgets/browser/positronIPyWidgetsService';
import { IPositronIPyWidgetsService } from 'vs/workbench/services/positronIPyWidgets/common/positronIPyWidgetsService';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from 'vs/workbench/common/contributions';

// Register the Positron IPyWidgets service.
registerSingleton(IPositronIPyWidgetsService, PositronIPyWidgetsService, InstantiationType.Delayed);

class PositronIPyWidgetsContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IPositronIPyWidgetsService positronIPyWidgetsService: IPositronIPyWidgetsService,
	) {
		super();
		this.registerActions();
	}

	private registerActions(): void {
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(PositronIPyWidgetsContribution, LifecyclePhase.Restored);
