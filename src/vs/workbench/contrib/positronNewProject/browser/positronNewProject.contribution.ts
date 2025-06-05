/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { ILifecycleService, LifecyclePhase, StartupKind } from '../../../services/lifecycle/common/lifecycle.js';
import { IPositronNewFolderService } from '../../../services/positronNewFolder/common/positronNewFolder.js';
import { PositronNewFolderService } from '../../../services/positronNewFolder/common/positronNewFolderService.js';

// Register the Positron New Folder service
registerSingleton(IPositronNewFolderService, PositronNewFolderService, InstantiationType.Delayed);

/**
 * PositronNewFolderContribution class.
 */
class PositronNewFolderContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronNewFolder';

	/**
	 * Create a new instance of the PositronNewFolderContribution.
	 * @param _lifecycleService The lifecycle service.
	 * @param _positronNewFolderService The Positron New Folder service.
	 */
	constructor(
		@ILifecycleService private readonly _lifecycleService: ILifecycleService,
		@IPositronNewFolderService private readonly _positronNewFolderService: IPositronNewFolderService,
	) {
		super();

		// Whether the new folder was opened in a new window or the existing window, the startup kind
		// will be `StartupKind.NewWindow`. However, if the new folder flow allowed the
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
	 * Run the Positron New Folder contribution, which initializes the new folder if applicable.
	 */
	private async run() {
		// Wait until after the workbench has been restored
		await this._lifecycleService.when(LifecyclePhase.Restored);
		await this._positronNewFolderService.initNewFolder();
	}
}

// Register the PositronNewFolderContribution
registerWorkbenchContribution2(PositronNewFolderContribution.ID, PositronNewFolderContribution, WorkbenchPhase.AfterRestored);
