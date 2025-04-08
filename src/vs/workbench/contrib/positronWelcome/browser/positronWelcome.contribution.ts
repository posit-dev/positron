/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { PositronImportSettings, ResetPositronImportPrompt } from './actions.js';
import { promptImport } from './helpers.js';

class PositronWelcomeContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
		this.registerActions();

		promptImport(
			this.storageService,
			this.notificationService,
			this.commandService,
		);
	}

	private registerActions(): void {
		this._register(registerAction2(PositronImportSettings));
		this._register(registerAction2(ResetPositronImportPrompt));
	}
}

registerWorkbenchContribution2('positron.welcome', PositronWelcomeContribution, WorkbenchPhase.Eventually);
