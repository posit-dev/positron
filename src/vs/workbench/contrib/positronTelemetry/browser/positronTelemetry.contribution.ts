/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IUpdateService } from '../../../../platform/update/common/update.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'update.resetAnonymousId',
			title: {
				value: localize('update.resetAnonymousId', "Reset Anonymous Telemetry ID"),
				original: 'Reset Anonymous Telemetry ID'
			},
			category: Categories.Preferences,
			f1: true
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const updateService = accessor.get(IUpdateService);
		const notificationService = accessor.get(INotificationService);

		updateService.resetTelemetryId();
		notificationService.info(localize('telemetryIdReset', "Your anonymous telemetry ID has been reset."));
	}
});
