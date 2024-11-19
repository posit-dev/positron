/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { ILifecycleService, LifecyclePhase, StartupKind } from '../../../services/lifecycle/common/lifecycle.js';
import { IPositronNewProjectService } from '../../../services/positronNewProject/common/positronNewProject.js';
import { PositronNewProjectService } from '../../../services/positronNewProject/common/positronNewProjectService.js';

// Register the Positron New Project service
registerSingleton(IPositronNewProjectService, PositronNewProjectService, InstantiationType.Delayed);

/**
 * PositronNewProjectContribution class.
 */
class PositronNewProjectContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronNewProject';

	/**
	 * Create a new instance of the PositronNewProjectContribution.
	 * @param _lifecycleService The lifecycle service.
	 * @param _positronNewProjectService The Positron New Project service.
	 */
	constructor(
		@ILifecycleService private readonly _lifecycleService: ILifecycleService,
		@IPositronNewProjectService private readonly _positronNewProjectService: IPositronNewProjectService,
	) {
		super();

		// Whether the new project directory was opened in a new window or the existing window, the
		// startup kind will be `StartupKind.NewWindow`. However, if the project wizard allowed the
		// user to select the directory that is currently open in Positron, the startup kind may be
		// `StartupKind.ReopenedWindow`.
		if (
			this._lifecycleService.startupKind === StartupKind.NewWindow ||
			this._lifecycleService.startupKind === StartupKind.ReopenedWindow
		) {
			this.run().then(undefined, onUnexpectedError);
		}
	}

	/**
	 * Run the Positron New Project contribution, which initializes the new project if applicable.
	 */
	private async run() {
		// Wait until after the workbench has been restored
		await this._lifecycleService.when(LifecyclePhase.Restored);
		await this._positronNewProjectService.initNewProject();
	}
}

// Register the PositronNewProjectContribution
registerWorkbenchContribution2(PositronNewProjectContribution.ID, PositronNewProjectContribution, WorkbenchPhase.AfterRestored);
