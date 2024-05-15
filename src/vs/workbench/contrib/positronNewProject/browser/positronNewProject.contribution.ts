/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from 'vs/base/common/errors';
import { Disposable } from 'vs/base/common/lifecycle';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from 'vs/workbench/common/contributions';
import { ILifecycleService, LifecyclePhase, StartupKind } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IPositronNewProjectService } from 'vs/workbench/services/positronNewProject/common/positronNewProject';
import { projectWizardEnabled } from 'vs/workbench/services/positronNewProject/common/positronNewProjectEnablement';
import { PositronNewProjectService } from 'vs/workbench/services/positronNewProject/common/positronNewProjectService';

// Register the Positron New Project service
registerSingleton(IPositronNewProjectService, PositronNewProjectService, InstantiationType.Delayed);

/**
 * PositronNewProjectContribution class.
 */
class PositronNewProjectContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronNewProject';

	/**
	 * Create a new instance of the PositronNewProjectContribution.
	 * @param _contextKeyService The context key service.
	 * @param _configurationService The configuration service.
	 * @param _lifecycleService The lifecycle service.
	 * @param _positronNewProjectService The Positron New Project service.
	 */
	constructor(
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILifecycleService private readonly _lifecycleService: ILifecycleService,
		@IPositronNewProjectService private readonly _positronNewProjectService: IPositronNewProjectService,
	) {
		super();
		// TODO: [New Project] Remove feature flag when New Project action is ready for release
		if (projectWizardEnabled(this._contextKeyService, this._configurationService)) {
			// Whether the project was opened in a new window or the existing window, the startup kind
			// will be `StartupKind.NewWindow`.
			if (
				this._lifecycleService.startupKind === StartupKind.NewWindow ||
				this._lifecycleService.startupKind === StartupKind.ReopenedWindow
			) {
				this.run().then(undefined, onUnexpectedError);
			}
		}
	}

	/**
	 * Run the Positron New Project contribution, which initializes the new project if applicable.
	 * @returns A promise that resolves to a boolean indicating whether the new project was initialized.
	 */
	private async run() {
		// Wait until after the workbench has been restored
		await this._lifecycleService.when(LifecyclePhase.Restored);
		await this._positronNewProjectService.initNewProject();
	}
}

// Register the PositronNewProjectContribution
registerWorkbenchContribution2(PositronNewProjectContribution.ID, PositronNewProjectContribution, WorkbenchPhase.AfterRestored);
